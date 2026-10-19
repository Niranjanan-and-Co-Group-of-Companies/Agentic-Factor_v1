// A mission build ("blueprint job") as the customer sees it: its progress events, its failure (with
// the real reason, the moment it happens), a retry with the same request, and — once the mission
// exists — the conversation that led to it, moved from Command Center into the mission's own chat.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LLMUsage } from '@/lib/services/llm-router';
import { usageCostUsd } from '@/lib/services/prices';

export interface BuildRequest { intent: string; priorQuestions?: string[]; sourceRequest?: string }

/** Records a build job's status; the Command Center polls the latest one. */
export async function recordJobStatus(supabase: SupabaseClient, tenantId: string, jobId: string, status: string, data: Record<string, unknown> = {}): Promise<void> {
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'blueprint.job_update',
    entity_type: 'blueprint_job',
    entity_id: jobId,
    payload: { jobId, status, ...data, updatedAt: new Date().toISOString() },
  });
}

/**
 * Charges what one build or update step's model calls really cost us (× the work markup), tagged with
 * the job so the total can be shown and a failure billed at the failure rate. Throws when the tenant's
 * credits run out.
 */
export async function chargeJobStep(tenantId: string, jobId: string, step: string, usage: LLMUsage[], missionId?: string): Promise<number> {
  const realCostUsd = usageCostUsd(usage);
  if (realCostUsd <= 0) return 0;
  const { chargeTowards } = await import('@/lib/middleware/billing');
  const sum = (k: 'inputTokens' | 'outputTokens' | 'cacheWriteTokens' | 'cacheReadTokens') => usage.reduce((n, u) => n + (u[k] ?? 0), 0);
  // The build's total is rounded up once, not each step's share.
  return chargeTowards(tenantId, { jobId }, realCostUsd, 'work', `build:${step}`, {
    provider: 'anthropic', model: [...new Set(usage.map(u => u.model))].join(', '),
    inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheWriteTokens: sum('cacheWriteTokens'), cacheReadTokens: sum('cacheReadTokens'),
    missionId,
  });
}

/** The request a job was started with, kept so a failed build can be tried again as it was. */
export async function jobRequest(supabase: SupabaseClient, tenantId: string, jobId: string): Promise<BuildRequest | null> {
  const { data } = await supabase.from('events')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('event_type', 'blueprint.job_update')
    .eq('entity_id', jobId)
    .not('payload->request', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const request = (data?.payload as { request?: BuildRequest } | undefined)?.request;
  return request && typeof request.intent === 'string' && request.intent.trim() ? request : null;
}

/** What the step was doing, from its progress line ("✍️ Writing code for Canva Designer…" → "writing code for Canva Designer"). */
function stepPhrase(step: string): string {
  const s = step.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[.…\s]+$/u, '').trim();
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : '';
}

/** The reason a build failed, in words a customer can act on — the real cause, never a generic line. */
export function buildFailureMessage(raw: string, lastStep?: string, errorName?: string): string {
  const msg = (raw || '').trim();
  if (/Circuit breaker OPEN|Circuit is OPEN/.test(msg)) return "We're briefly managing system load — please wait 30 seconds and try again.";
  if (msg.includes('No LLM provider available')) return 'AI services are temporarily unavailable. Please try again in a moment.';
  if (/rate limit|\b429\b/i.test(msg)) return 'Too many requests right now — please wait a moment and try again.';
  if (errorName === 'ZodError' || /"code":\s*"invalid_type"|"code":\s*"too_small"/.test(msg)) {
    // A validation dump means nothing to a customer: say which parts were missing.
    const fields = [...new Set([...msg.matchAll(/"path":\s*\[\s*"([^"]+)"/g)].map(m => m[1]))];
    return `The mission design came back incomplete${fields.length ? ` (missing: ${fields.join(', ')})` : ''}. Please try again.`;
  }
  // The platform stopped a step that ran past its time limit (the error then says little more than that).
  if (/FUNCTION_INVOCATION_TIMEOUT|timed? ?out|took too long|maximum (execution|duration)|\b504\b|gateway timeout/i.test(msg)) {
    const doing = lastStep ? stepPhrase(lastStep) : '';
    return `Building stopped${doing ? ` while ${doing}` : ''}: that step ran out of time. Try again — if it stops again, split the request into two smaller missions.`;
  }
  return msg ? msg.slice(0, 400) : 'The build stopped without saying why. Please try again.';
}

/**
 * Reports a failed build once: the job's status (with the real reason) and the Command Center message
 * that started it, which keeps the job id so "Try again" can rebuild it.
 */
export async function reportBuildFailure(supabase: SupabaseClient, tenantId: string, jobId: string, raw: string, errorName?: string, credits?: number): Promise<string> {
  const { data: latest } = await supabase.from('events')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('event_type', 'blueprint.job_update')
    .eq('entity_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = latest?.payload as { status?: string; step?: string; error?: string } | undefined;
  if (last?.status === 'failed' && last.error) return last.error;
  const error = buildFailureMessage(raw, last?.step, errorName);
  await recordJobStatus(supabase, tenantId, jobId, 'failed', { error, credits });
  await supabase.from('mission_chat_messages')
    .update({ action_payload: { type: 'mission_create_error', error, jobId, credits } })
    .eq('tenant_id', tenantId)
    .eq('action_payload->>jobId', jobId);
  return error;
}

// ── The build conversation, moved into the mission's chat ────────────────────

export interface ThreadMessage {
  id: string;
  role: string;
  content: string | null;
  action_payload: Record<string, unknown> | null;
  created_at: string;
}

/** Cards that belong to the build itself; any other card is an earlier, separate task. */
const BUILD_CARDS = new Set(['building_blueprint', 'blueprint_question', 'mission_create_error']);

/**
 * The conversation that led to a build, oldest first, ending with the build message: walks back over
 * the request, the architect's questions and the answers, and stops at an earlier task's card, a long
 * pause, or `maxUserMessages` messages from the customer.
 */
export function buildThread(messages: ThreadMessage[], { maxGapMs = 2 * 60 * 60_000, maxUserMessages = 6 } = {}): ThreadMessage[] {
  const thread: ThreadMessage[] = [];
  let users = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const later = thread[0];
    if (later && Date.parse(later.created_at) - Date.parse(m.created_at) > maxGapMs) break;
    const card = m.action_payload?.type;
    if (later && typeof card === 'string' && !BUILD_CARDS.has(card)) break;
    if (m.role === 'user') {
      if (users >= maxUserMessages) break;
      users++;
    }
    thread.unshift(m);
  }
  while (thread.length > 1 && thread[0].role !== 'user') thread.shift();
  return thread;
}

export type { ThreadNote } from '@/lib/contracts';
import type { ThreadNote } from '@/lib/contracts';

const shortDate = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Copies the conversation that built a mission from Command Center (which starts empty on every visit)
 * into a new chat of the mission, between a "Started in Command Center" header and a "Mission created"
 * note, so the request, questions and answers stay with the mission. Returns the new chat's id.
 */
export async function moveBuildThread(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  mission: { id: string; title: string; agentCount: number },
): Promise<string | null> {
  try {
    const { data: buildMsg } = await supabase.from('mission_chat_messages')
      .select('id, chat_id, created_at')
      .eq('tenant_id', tenantId)
      .eq('action_payload->>jobId', jobId)
      .limit(1)
      .maybeSingle();
    if (!buildMsg) return null;
    const { data: recent } = await supabase.from('mission_chat_messages')
      .select('id, role, content, action_payload, created_at')
      .eq('chat_id', buildMsg.chat_id)
      .lte('created_at', buildMsg.created_at)
      .order('created_at', { ascending: false })
      .limit(40);
    const thread = buildThread(((recent ?? []) as ThreadMessage[]).reverse());
    if (thread.length === 0) return null;

    const { data: chat } = await supabase.from('mission_chats')
      .insert({ mission_id: mission.id, tenant_id: tenantId, title: 'Mission setup' })
      .select('id')
      .single();
    if (!chat?.id) return null;

    const startedAt = thread[0].created_at;
    const now = new Date().toISOString();
    const started: ThreadNote = { type: 'thread_note', kind: 'started', at: startedAt };
    const created: ThreadNote = { type: 'thread_note', kind: 'created', at: now, missionId: mission.id, missionTitle: mission.title };
    const rows = [
      {
        chat_id: chat.id, tenant_id: tenantId, role: 'assistant', action_payload: started, action_applied: true,
        content: `Started in Command Center · ${shortDate(startedAt)}`,
        created_at: new Date(Date.parse(startedAt) - 1).toISOString(),
      },
      ...thread.map(m => ({
        chat_id: chat.id, tenant_id: tenantId, role: m.role, content: m.content ?? '', action_payload: null, created_at: m.created_at,
      })),
      {
        chat_id: chat.id, tenant_id: tenantId, role: 'assistant', action_payload: created, action_applied: true,
        content: `✅ Mission created: ${mission.title} (${mission.agentCount} agent${mission.agentCount === 1 ? '' : 's'}). Continue here — connect apps, run the rehearsal, set a schedule.`,
        created_at: now,
      },
    ];
    const { error } = await supabase.from('mission_chat_messages').insert(rows);
    if (error) {
      console.warn('[build-jobs] Could not copy the build conversation:', error.message);
      await supabase.from('mission_chats').delete().eq('id', chat.id);
      return null;
    }
    return chat.id as string;
  } catch (err) {
    console.warn('[build-jobs] Could not move the build conversation:', err);
    return null;
  }
}
