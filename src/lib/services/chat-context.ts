/**
 * Chat Context Builder
 * Assembles the full system prompt for the mission AI assistant.
 * Called fresh on every chat message — context stays current.
 */

import { createServiceClient } from '@/lib/supabase/server';

export interface ChatContext {
  systemPrompt: string;
  proactiveAlert: string | null; // non-null only on first load
}

export async function buildChatContext(
  missionId: string,
  tenantId: string,
  isFirstLoad = false
): Promise<ChatContext> {
  const supabase = createServiceClient();

  // ── 1. Fetch mission ────────────────────────────────────────
  const { data: missionRow } = await supabase
    .from('missions')
    .select('mission_json, status, title')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  const missionTitle: string = missionRow?.title ?? 'this mission';
  const mission = missionRow?.mission_json as Record<string, unknown> | null;
  const missionStatus: string = missionRow?.status ?? 'unknown';

  // ── 2. Agents summary (non-technical) ──────────────────────
  let agentsSummary = 'No agents configured yet.';
  if (mission?.agents && Array.isArray(mission.agents) && mission.agents.length > 0) {
    const agents = mission.agents as Array<{ role?: string; agentIndex?: number; capabilities?: string[]; systemPrompt?: string }>;
    agentsSummary = agents
      .sort((a, b) => (a.agentIndex ?? 0) - (b.agentIndex ?? 0))
      .map((a, i) => `  Agent ${i + 1}: ${a.role ?? 'Unnamed'} — ${a.capabilities?.slice(0, 3).join(', ') || 'general purpose'}`)
      .join('\n');
  }

  // ── 3. Connected connectors ─────────────────────────────────
  const { data: perms } = await supabase
    .from('tenant_permissions')
    .select('provider, access_token')
    .eq('tenant_id', tenantId);

  const connectedProviders = (perms ?? []).map(p => p.provider);
  const connectorsList = connectedProviders.length > 0
    ? connectedProviders.join(', ')
    : 'none connected yet';

  // Permissions required by this mission but not yet granted
  const requiredPerms = (mission?.permissions as Array<{ service: string; granted?: boolean }> ?? []);
  const missingConnectors = requiredPerms
    .filter(p => !p.granted && !connectedProviders.includes(p.service))
    .map(p => p.service);

  // ── 4. Last 3 run summaries ─────────────────────────────────
  let runsSummary = 'No runs yet.';
  try {
    const { data: runs } = await supabase
      .from('mission_runs')
      .select('run_number, status, started_at, duration_ms, agents_total, agents_done, agents_failed, summary')
      .eq('mission_id', missionId)
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .limit(3);

    if (runs && runs.length > 0) {
      runsSummary = runs.map(r => {
        const when = r.started_at ? new Date(r.started_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'unknown time';
        const dur = r.duration_ms ? `${Math.round(r.duration_ms / 1000)}s` : '?s';
        const detail = r.status === 'failed' && r.agents_failed
          ? ` (${r.agents_failed} agent(s) failed)`
          : r.status === 'completed'
          ? ` (${r.agents_done}/${r.agents_total} agents done)`
          : '';
        return `  Run #${r.run_number}: ${r.status}${detail}, started ${when}, duration ${dur}`;
      }).join('\n');
    }
  } catch { /* runs table may not exist on new installs */ }

  // ── 5. Tenant memory (business facts) ──────────────────────
  let memoryFacts = '';
  try {
    const { data: mem } = await supabase
      .from('tenant_memory')
      .select('fact')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (mem && mem.length > 0) {
      memoryFacts = '\n\nKNOWN FACTS ABOUT THIS CUSTOMER:\n' + mem.map(m => `  - ${m.fact}`).join('\n');
    }
  } catch { /* non-fatal */ }

  // ── 6. Scheduling status ────────────────────────────────────
  let scheduleInfo = 'No schedule set.';
  try {
    const { data: sched } = await supabase
      .from('mission_schedules')
      .select('cron_expression, timezone, is_active, next_run_at')
      .eq('mission_id', missionId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (sched?.cron_expression) {
      scheduleInfo = `Cron: ${sched.cron_expression} (${sched.timezone ?? 'UTC'}), active: ${sched.is_active ? 'yes' : 'paused'}`;
      if (sched.next_run_at) {
        scheduleInfo += `, next run: ${new Date(sched.next_run_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
      }
    }
  } catch { /* non-fatal */ }

  // ── 7. Assemble system prompt ───────────────────────────────
  const systemPrompt = `You are the AI assistant built into AgenticFactor, helping this customer manage and improve their specific mission.

CURRENT MISSION: "${missionTitle}"
STATUS: ${missionStatus}
MISSION ID: ${missionId}

AGENTS IN THIS MISSION:
${agentsSummary}

CONNECTED SERVICES: ${connectorsList}
${missingConnectors.length > 0 ? `MISSING (required but not connected): ${missingConnectors.join(', ')}` : ''}

RECENT RUNS:
${runsSummary}

SCHEDULE: ${scheduleInfo}
${memoryFacts}

YOUR ROLE AND RULES:
- You help the customer IMPROVE THIS SPECIFIC MISSION — add agents, add connectors, change behavior, schedule runs, set up webhooks, explain failures, suggest improvements.
- If the customer asks "can we add Stripe/Razorpay/any-service to this mission?" — answer YES or explain how to add it to this mission. Always bring it back to improving this mission.
- If asked about unrelated topics, gently redirect: "That's outside this mission, but here's how we could add that capability to your mission..."
- NEVER suggest the customer go elsewhere or use a different platform.
- Be conversational, warm, and non-technical. Customers are business owners, not developers.
- Keep responses concise — 2–4 short paragraphs max unless the customer explicitly asks for detail.
- When you want to take an ACTION (create a schedule, suggest a connector, trigger a run, save settings), include a structured action block at the END of your message in this exact format:
  <action>{"type":"ACTION_TYPE","label":"Human readable description of what will happen",...extra fields}</action>

SUPPORTED ACTION TYPES (include relevant extra fields):
- schedule: {"type":"schedule","cron":"0 9 * * 1","timezone":"Asia/Kolkata","label":"Every Monday at 9:00 AM IST"}
- run_now: {"type":"run_now","label":"Run this mission now"}
- suggest_connector: {"type":"suggest_connector","provider":"stripe","label":"Connect Stripe to enable payment tracking"}
- webhook: {"type":"webhook","label":"Generate webhook URL for this mission"}

TODAY: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' })}

Remember: you are inside this specific mission. Everything you say is about making THIS mission better.`;

  // ── 8. Proactive alert (only on first load) ─────────────────
  let proactiveAlert: string | null = null;
  if (isFirstLoad) {
    try {
      const { data: lastRun } = await supabase
        .from('mission_runs')
        .select('status, agents_failed, started_at')
        .eq('mission_id', missionId)
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

      if (lastRun?.status === 'failed') {
        proactiveAlert = `Your last run failed${lastRun.agents_failed ? ` (${lastRun.agents_failed} agent(s) had errors)` : ''}. Want me to diagnose what went wrong and suggest a fix?`;
      } else if (missingConnectors.length > 0) {
        proactiveAlert = `This mission needs ${missingConnectors.join(', ')} to be connected before it can run. Want me to walk you through connecting ${missingConnectors[0]}?`;
      } else if (missionStatus === 'draft') {
        proactiveAlert = `"${missionTitle}" is still in draft. Want to do a test run or schedule it to go live?`;
      }
    } catch { /* non-fatal */ }
  }

  return { systemPrompt, proactiveAlert };
}
