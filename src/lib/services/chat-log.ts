// Entries the platform writes into a chat's history — a run card, an approval decision, the result of
// a button (schedule set, went live, connected…) — so the conversation keeps what happened, not just
// what was said. Each is a chat message whose text reads well (for people and for the assistant) and
// whose action_payload lets the chat draw it as a card.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApprovalRecordPayload } from '@/lib/services/approval-records';

export const RESULT_KINDS = ['run', 'schedule', 'unschedule', 'pause', 'resume', 'go_live', 'connect', 'webhook', 'revert', 'update'] as const;
export type ResultKind = typeof RESULT_KINDS[number];

export interface RunCardEntry {
  type: 'run_card';
  runId: string;
  runNumber?: number;
  trigger?: string;
  missionId: string;
  missionTitle?: string;
}

export interface ActionResultEntry {
  type: 'action_result';
  kind: ResultKind;
  ok: boolean;
  /** What was asked for, e.g. "Every Monday 9am IST". */
  label: string;
  /** The outcome in a line, e.g. "Next run Mon 20 Oct, 9:00 am". */
  detail?: string;
  /** Why it failed. */
  error?: string;
  missionId?: string;
  missionTitle?: string;
  via?: 'mission_chat' | 'command_center';
  by?: string;
  at: string;
  /** The original chat action, so a failed one can be retried from the history. */
  action?: Record<string, unknown>;
}

export type ChatEntry = RunCardEntry | ActionResultEntry | (ApprovalRecordPayload & { missionId?: string; missionTitle?: string });

const KIND_DONE: Record<ResultKind, string> = {
  run: 'Run started', schedule: 'Schedule set', unschedule: 'Schedule removed', pause: 'Mission paused',
  resume: 'Mission resumed', go_live: 'Mission is live', connect: 'Connected', webhook: 'Webhook ready',
  revert: 'Reverted', update: 'Mission updated',
};
const KIND_FAILED: Record<ResultKind, string> = {
  run: 'Couldn’t start the run', schedule: 'Couldn’t set the schedule', unschedule: 'Couldn’t remove the schedule',
  pause: 'Couldn’t pause the mission', resume: 'Couldn’t resume the mission', go_live: 'Couldn’t switch to live',
  connect: 'Couldn’t connect', webhook: 'Couldn’t create the webhook', revert: 'Couldn’t revert', update: 'Couldn’t update the mission',
};

export const resultTitle = (e: Pick<ActionResultEntry, 'kind' | 'ok'>) => (e.ok ? KIND_DONE : KIND_FAILED)[e.kind];

/** The entry as a line of chat history. */
export function entryText(e: ChatEntry): string {
  if (e.type === 'run_card') return `▶ Run${e.runNumber ? ` #${e.runNumber}` : ''} started${e.trigger && e.trigger !== 'manual' ? ` (${e.trigger})` : ''}${e.missionTitle ? ` — ${e.missionTitle}` : ''}.`;
  if (e.type === 'action_result') {
    const parts = [`${e.ok ? '✅' : '⚠️'} ${resultTitle(e)}: ${e.label}`];
    if (e.detail) parts.push(e.detail);
    if (!e.ok && e.error) parts.push(`Reason: ${e.error}`);
    return `${parts.join(' — ')}.`;
  }
  return '';
}

/** A client-sent entry, checked and trimmed (only these shapes are ever stored). */
export function validateEntry(raw: unknown): RunCardEntry | ActionResultEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  if (r.type === 'run_card' && str(r.runId, 64) && str(r.missionId, 64)) {
    return { type: 'run_card', runId: str(r.runId, 64)!, missionId: str(r.missionId, 64)!, runNumber: typeof r.runNumber === 'number' ? r.runNumber : undefined, trigger: str(r.trigger, 32), missionTitle: str(r.missionTitle, 200) };
  }
  if (r.type === 'action_result' && RESULT_KINDS.includes(r.kind as ResultKind) && str(r.label)) {
    return {
      type: 'action_result', kind: r.kind as ResultKind, ok: r.ok === true, label: str(r.label)!,
      detail: str(r.detail), error: str(r.error, 500), missionId: str(r.missionId, 64), missionTitle: str(r.missionTitle, 200),
      via: r.via === 'command_center' ? 'command_center' : 'mission_chat', at: new Date().toISOString(),
      action: r.action && typeof r.action === 'object' ? r.action as Record<string, unknown> : undefined,
    };
  }
  return null;
}

/** Adds the entry to a chat (session) and moves that chat to the top. */
export async function saveToChat(supabase: SupabaseClient, tenantId: string, chatId: string, entry: ChatEntry, text = entryText(entry)): Promise<string | null> {
  const { data, error } = await supabase.from('mission_chat_messages').insert({
    chat_id: chatId, tenant_id: tenantId, role: 'assistant', content: text, action_payload: entry, action_applied: true,
  }).select('id').single();
  if (error) {
    console.warn('[chat-log] Could not save to the chat:', error.message);
    return null;
  }
  await supabase.from('mission_chats').update({ updated_at: new Date().toISOString() }).eq('id', chatId);
  return (data?.id as string | undefined) ?? null;
}

/** The mission's most recent chat, created (titled `title`) when the mission has none. */
export async function missionChatId(supabase: SupabaseClient, tenantId: string, missionId: string, title = 'Mission activity'): Promise<string | null> {
  const { data: latest } = await supabase
    .from('mission_chats')
    .select('id')
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest?.id) return latest.id as string;
  const { data: created } = await supabase
    .from('mission_chats')
    .insert({ mission_id: missionId, tenant_id: tenantId, title })
    .select('id')
    .single();
  return (created?.id as string | undefined) ?? null;
}

/** Saves the entry into the mission's chat. Never throws: what happened stands either way. */
export async function saveToMissionChat(supabase: SupabaseClient, tenantId: string, missionId: string, entry: ChatEntry, text?: string): Promise<string | null> {
  try {
    const chatId = await missionChatId(supabase, tenantId, missionId);
    return chatId ? await saveToChat(supabase, tenantId, chatId, entry, text) : null;
  } catch (err) {
    console.warn('[chat-log] Could not save to the mission chat:', err);
    return null;
  }
}

/** Records a run's card in its mission's chat once, however many times the run is resumed. */
export async function recordRunCard(supabase: SupabaseClient, tenantId: string, entry: RunCardEntry): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('mission_chat_messages')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('action_payload->>type', 'run_card')
      .eq('action_payload->>runId', entry.runId)
      .limit(1)
      .maybeSingle();
    if (existing) return;
    await saveToMissionChat(supabase, tenantId, entry.missionId, entry);
  } catch (err) {
    console.warn('[chat-log] Could not record the run card:', err);
  }
}
