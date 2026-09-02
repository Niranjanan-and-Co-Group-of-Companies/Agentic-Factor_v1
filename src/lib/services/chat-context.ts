/**
 * Chat Context Builder — assembles the full system prompt for mission AI agents.
 *
 * All 8 layers, in priority order:
 *   1. Agent identity + role (from mission brief)
 *   2. Scope and responsibilities
 *   3. Available tools (grouped by provider)
 *   4. Customer profile (from agent_profiles)
 *   5. Recent sessions (from agent_episodes)
 *   6. Run history + schedule
 *   7. Tenant business facts (from tenant_memory)
 *   8. Operating principles + current date/time
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getMemoryContext } from '@/lib/services/agent-memory';

export interface ChatContext {
  systemPrompt: string;
  proactiveAlert: string | null;
  connectedProviders: string[];
}

export async function buildChatContext(
  missionId: string,
  tenantId: string,
  isFirstLoad = false
): Promise<ChatContext> {
  const supabase = createServiceClient();

  // ── Fetch mission ────────────────────────────────────────────────────
  const { data: missionRow } = await supabase
    .from('missions')
    .select('mission_json, status, title')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  const missionTitle: string = missionRow?.title ?? 'this mission';
  const mission = missionRow?.mission_json as Record<string, unknown> | null;
  const missionStatus: string = missionRow?.status ?? 'unknown';

  // ── Agent definitions ────────────────────────────────────────────────
  type AgentDef = { role?: string; agentIndex?: number; capabilities?: string[]; systemPrompt?: string };
  let agentsSummary = 'No agents configured yet.';
  let agentPrompts = '';
  if (Array.isArray(mission?.agents) && (mission.agents as AgentDef[]).length > 0) {
    const agents = (mission.agents as AgentDef[]).sort((a, b) => (a.agentIndex ?? 0) - (b.agentIndex ?? 0));
    agentsSummary = agents
      .map((a, i) => `  Agent ${i + 1}: ${a.role ?? 'Unnamed'} — ${a.capabilities?.slice(0, 3).join(', ') || 'general purpose'}`)
      .join('\n');
    // Include any custom systemPrompts from the blueprint
    const promptLines = agents.filter(a => a.systemPrompt).map(a => `[${a.role}] ${a.systemPrompt}`);
    if (promptLines.length > 0) agentPrompts = '\n\nAGENT INSTRUCTIONS:\n' + promptLines.join('\n');
  }

  // ── Connected connectors ─────────────────────────────────────────────
  const { data: perms } = await supabase
    .from('tenant_permissions')
    .select('provider, access_token')
    .eq('tenant_id', tenantId);

  const connectedProviders = (perms ?? []).map(p => p.provider);

  const LEGACY_ALIASES: Record<string, string[]> = {
    gmail: ['google', 'gmail'],
    linkedin: ['linkedin_oidc', 'linkedin'],
    jira: ['atlassian', 'jira'],
    outlook: ['microsoft', 'outlook'],
    microsoftteams: ['microsoft', 'microsoftteams'],
  };
  function isConnected(service: string): boolean {
    const s = service.toLowerCase();
    return (LEGACY_ALIASES[s] ?? [s]).some(c => connectedProviders.includes(c));
  }

  const requiredPerms = (mission?.permissions as Array<{ service: string; granted?: boolean }> ?? []);
  const missingConnectors = requiredPerms
    .filter(p => !p.granted && !isConnected(p.service))
    .map(p => p.service);

  // ── Tool availability block ──────────────────────────────────────────
  // Load schemas to build the "what you can do" section of the prompt
  let toolsBlock = '';
  try {
    const { data: toolRows } = await supabase
      .from('mission_tool_schemas')
      .select('provider_slug, action_name, display_name')
      .eq('tenant_id', tenantId)
      .eq('mission_id', missionId)
      .eq('is_active', true)
      .order('provider_slug')
      .limit(80);

    if (toolRows && toolRows.length > 0) {
      const byProvider = new Map<string, string[]>();
      for (const t of toolRows) {
        const list = byProvider.get(t.provider_slug) ?? [];
        list.push(t.display_name || t.action_name);
        byProvider.set(t.provider_slug, list);
      }
      const lines: string[] = ['YOUR AVAILABLE TOOLS (use them — don\'t ask the customer to do things you can do yourself):'];
      for (const [provider, actions] of byProvider) {
        lines.push(`  ${provider.toUpperCase()}: ${actions.slice(0, 8).join(', ')}${actions.length > 8 ? `, +${actions.length - 8} more` : ''}`);
      }
      // Always-available system tools
      lines.push('  SYSTEM: Read run error logs');
      toolsBlock = lines.join('\n');
    } else if (connectedProviders.length > 0) {
      // Tools not yet fetched — still tell the LLM what providers are available
      toolsBlock = `YOUR AVAILABLE TOOLS:\n  Connected providers: ${connectedProviders.join(', ')}\n  Use execute_composio_action with the exact Composio action slug for any of these.\n  SYSTEM: Read run error logs`;
    }
  } catch { /* non-fatal */ }

  // ── Run history ──────────────────────────────────────────────────────
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
        const when = r.started_at ? new Date(r.started_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '?';
        const dur = r.duration_ms ? `${Math.round(r.duration_ms / 1000)}s` : '?s';
        const detail = r.status === 'failed' && r.agents_failed
          ? ` (${r.agents_failed} agent(s) failed)`
          : r.status === 'completed' ? ` (${r.agents_done}/${r.agents_total} agents done)` : '';
        return `  Run #${r.run_number}: ${r.status}${detail}, started ${when}, ${dur}`;
      }).join('\n');
    }
  } catch { /* non-fatal */ }

  // ── Schedule ─────────────────────────────────────────────────────────
  let scheduleInfo = 'No schedule set.';
  try {
    const { data: sched } = await supabase
      .from('mission_schedules')
      .select('cron_expression, timezone, is_active, next_run_at')
      .eq('mission_id', missionId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (sched?.cron_expression) {
      scheduleInfo = `${sched.cron_expression} (${sched.timezone ?? 'UTC'}), active: ${sched.is_active ? 'yes' : 'paused'}`;
      if (sched.next_run_at) {
        scheduleInfo += `, next: ${new Date(sched.next_run_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
      }
    }
  } catch { /* non-fatal */ }

  // ── Tenant memory (business facts) ───────────────────────────────────
  let tenantFacts = '';
  try {
    const { data: mem } = await supabase
      .from('tenant_memory')
      .select('fact')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (mem && mem.length > 0) {
      tenantFacts = '\nBUSINESS FACTS:\n' + mem.map(m => `  - ${m.fact}`).join('\n');
    }
  } catch { /* non-fatal */ }

  // ── Agent memory (profile + episodes) ────────────────────────────────
  const { profileBlock, episodesBlock } = await getMemoryContext(tenantId, missionId);

  // ── Assemble system prompt — all 8 layers ────────────────────────────
  const now = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const systemPrompt = `You are the AI agent built into "${missionTitle}" on AgenticFactor.
You are not a general-purpose assistant — you are this mission's dedicated agent.
Your job is to ACCOMPLISH THINGS, not just give advice. If you can do it with your tools, do it.

MISSION: "${missionTitle}"
STATUS: ${missionStatus}
MISSION ID: ${missionId}

AGENTS IN THIS MISSION:
${agentsSummary}${agentPrompts}

CONNECTED SERVICES: ${connectedProviders.length > 0 ? connectedProviders.join(', ') : 'none connected yet'}
${missingConnectors.length > 0 ? `STILL NEEDED: ${missingConnectors.join(', ')} — suggest connecting these` : ''}

${toolsBlock ? toolsBlock + '\n' : ''}
${profileBlock ? profileBlock + '\n\n' : ''}${episodesBlock ? episodesBlock + '\n\n' : ''}
RECENT RUNS:
${runsSummary}

SCHEDULE: ${scheduleInfo}
${tenantFacts}

OPERATING PRINCIPLES:
- LANGUAGE: Detect the language the customer writes or speaks in and always reply in that exact same language. Never switch languages unless the customer does. Hindi → Hindi. Tamil → Tamil. Same for every language.
- ACT, don't advise. If the customer says "book a session", book it. Don't say "you can book a session by…"
- Use your tools. Every connected provider has actions you can call right now.
- When you complete an action, confirm what you DID (past tense), not what you PLAN to do.
- If a tool call fails, explain what happened and try an alternative approach.
- Be conversational and warm — customers are business owners, not developers.
- Keep responses concise: 2–4 short paragraphs max unless more detail is explicitly requested.
- Never say "I can't do that" for things a connected service supports. If it's connected, you can act.
- Never suggest the customer use a different platform or go elsewhere.

TOOL USAGE RULES:
- "Why did it fail?" / "What went wrong?" → call get_run_errors immediately, answer from real data
- "Create X" / "Book X" / "Schedule X" → call the relevant tool, do it now
- "Check if X exists" / "Look up X" → call the relevant tool to actually look it up
- "Send X" / "Post X" / "Email X" → call the relevant tool to send it
- Don't ask for confirmation before acting on unambiguous requests
- After completing actions, summarise what was done

STRUCTURED ACTIONS (include at end of message when relevant):
<action>{"type":"run_now","label":"Run this mission now"}</action>
<action>{"type":"resume_run","label":"Resume from where it failed"}</action>
<action>{"type":"go_live","label":"Switch to live execution"}</action>
<action>{"type":"schedule","cron":"0 9 * * 1","timezone":"Asia/Kolkata","label":"Every Monday 9am IST"}</action>
<action>{"type":"suggest_connector","provider":"stripe","label":"Connect Stripe"}</action>
<action>{"type":"webhook","label":"Generate webhook URL"}</action>
<action>{"type":"update_mission","label":"Apply changes to mission","summary":"one sentence describing what changes to make"}</action>

UPDATE_MISSION RULES:
- Emit update_mission when the customer asks to add, remove, or change what the mission DOES (new steps, new connectors, different logic, new agents)
- The "summary" field must describe the change concisely — it becomes the actual instruction passed to the blueprint engine
- Do NOT emit update_mission for run/schedule/connector changes — those have their own action types
- After emitting, explain in plain language what will change so the customer can confirm before clicking Apply

TODAY: ${now}`;

  // ── Proactive alert (first load only) ────────────────────────────────
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
        proactiveAlert = `Your last run failed${lastRun.agents_failed ? ` (${lastRun.agents_failed} agent(s) had errors)` : ''}. Want me to diagnose what went wrong?`;
      } else if (missingConnectors.length > 0) {
        proactiveAlert = `This mission needs ${missingConnectors.join(', ')} to be connected before it can run. Want help connecting ${missingConnectors[0]}?`;
      } else if (missionStatus === 'draft') {
        proactiveAlert = `"${missionTitle}" is in draft. Want to test it or set a schedule?`;
      }
    } catch { /* non-fatal */ }
  }

  return { systemPrompt, proactiveAlert, connectedProviders };
}
