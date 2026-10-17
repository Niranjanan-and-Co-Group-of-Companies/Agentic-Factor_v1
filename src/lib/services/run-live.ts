// The live state of a mission run, as one view: the run, each agent's step, any approval it waits on,
// and whether it is a rehearsal. The chat's run card, the progress strip and the Command Center all
// read this same view, so they can never disagree about how far a run has got.

import { createServiceClient } from '@/lib/supabase/server';
import { humanizeAction } from '@/lib/utils/app-name';
import { describeApproval, type ProposedActionRow } from '@/lib/services/approval-records';
import { actionLabel, declaredActions, missionCatalog } from '@/lib/services/app-catalog';

export { humanizeAction };

export type RunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed';
export type AgentStep = 'waiting' | 'working' | 'repairing' | 'checking' | 'acting' | 'approval' | 'paused' | 'done' | 'failed' | 'skipped';

export interface LiveAgent {
  id: string;
  role: string;
  /** Composio toolkit slugs this agent's script calls, for its app logos. */
  apps: string[];
  step: AgentStep;
  /** Attempt number while repairing (2 = first repair). */
  attempt?: number;
  maxAttempts?: number;
  /** Short plain-language detail: the error being repaired, or why it stopped. */
  note?: string;
  startedAt?: string;
  finishedAt?: string;
  /** Time of the latest sign of life from this agent. */
  lastSignalAt?: string;
}

export interface LiveApproval {
  id: string;
  agentId: string;
  agentRole: string;
  /** rehearsal = a preview to check (nothing real happens); live = permission for a real action. */
  kind: 'rehearsal' | 'live';
  actions: string[];
  preview?: string;
  submittedAt?: string;
}

export interface LiveRun {
  id: string;
  number: number;
  status: RunStatus;
  mode: 'rehearsal' | 'live';
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  agentsTotal: number;
  agentsDone: number;
  agentsFailed: number;
  error?: string;
  summary?: string;
  /** Credits charged for this run so far (at the failure rate once it has failed). */
  credits?: number;
}

export interface LiveRunView {
  mission: { id: string; title: string; status: string; /** the next run is a rehearsal */ rehearsal: boolean };
  run: LiveRun | null;
  agents: LiveAgent[];
  approval: LiveApproval | null;
  /** Official name and logo of each app the agents use, from Composio's catalog. */
  apps: Record<string, { name: string; logo: string }>;
  /** Median duration of recent completed runs, for "usually ~25s". */
  typicalMs: number | null;
  serverTime: string;
}

export interface RunEventRow {
  event_type: string;
  entity_id: string | null;
  created_at: string;
  attempt?: string | null;
  max_attempts?: string | null;
  error?: string | null;
  phase?: string | null;
}

const REHEARSAL_PREFIX = /^TRAINING REHEARSAL[^.]*\.\s*(IDs\/URLs[^.]*\.\s*)?/;

/** Composio toolkits an agent's script calls: action prefixes and proxied toolkits matched to the mission's apps. */
export function appsInScript(script: string, toolkits: string[]): string[] {
  const actions = [...script.matchAll(/composio_execute\s*\(\s*["']([A-Z][A-Z0-9_]{3,})["']/g)].map(m => m[1]);
  const proxied = [...script.matchAll(/composio_proxy\(\s*["']([A-Za-z0-9_]+)["']/g)].map(m => m[1].toLowerCase());
  // Longest slug first, so ZOHO_BOOKS_* belongs to zoho_books rather than a shorter zoho.
  const kits = [...toolkits].sort((a, b) => b.length - a.length);
  const found = new Set<string>();
  for (const action of actions) {
    const kit = kits.find(t => action.startsWith(`${t.toUpperCase()}_`));
    if (kit) found.add(kit);
  }
  for (const p of proxied) found.add(p);
  return [...found].slice(0, 3);
}

/** Plain, short error text for the card (the full text stays in the run log). */
export function shortError(raw: string | null | undefined, max = 220): string | undefined {
  if (!raw) return undefined;
  const text = String(raw)
    .replace(/^Agent "[^"]+" failed after \d+ attempts?\.\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Was this run a rehearsal? Rehearsal mode was on when it started (it switches off when one passes). */
export function runMode(run: { started_at: string; summary?: string | null }, mission: { training_enabled?: boolean | null; training_graduated_at?: string | null }): 'rehearsal' | 'live' {
  if (String(run.summary ?? '').startsWith('TRAINING REHEARSAL')) return 'rehearsal';
  if (mission.training_graduated_at) return Date.parse(run.started_at) < Date.parse(mission.training_graduated_at) ? 'rehearsal' : 'live';
  return mission.training_enabled ? 'rehearsal' : 'live';
}

/** Each agent's step in this run, from the run's events, its status and any pending approval. */
export function deriveAgents(input: {
  agents: Array<{ id: string; role: string; apps: string[] }>;
  events: RunEventRow[];
  runStatus: RunStatus;
  approvalAgentId?: string | null;
  runError?: string | null;
}): LiveAgent[] {
  const { agents, events, runStatus, approvalAgentId, runError } = input;
  const finished = runStatus === 'completed' || runStatus === 'failed';
  return agents.map(agent => {
    const mine = events.filter(e => e.entity_id === agent.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const started = mine.find(e => e.event_type === 'agent.started');
    const completed = mine.find(e => e.event_type === 'agent.completed');
    const last = mine[mine.length - 1];
    const base: LiveAgent = {
      id: agent.id, role: agent.role, apps: agent.apps, step: 'waiting',
      startedAt: started?.created_at, lastSignalAt: last?.created_at,
    };
    if (completed) return { ...base, step: 'done', finishedAt: completed.created_at };
    if (approvalAgentId === agent.id) return { ...base, step: 'approval' };
    if (!started) return { ...base, step: finished ? 'skipped' : 'waiting' };
    if (runStatus === 'failed') return { ...base, step: 'failed', note: shortError(runError), finishedAt: last?.created_at };
    // It started and the run completed, so it finished — a rehearsal check records no completion of its own.
    if (runStatus === 'completed') return { ...base, step: 'done', finishedAt: last?.created_at };
    if (runStatus === 'paused') return { ...base, step: 'paused' };

    // Still going: the latest signal says what it is doing now.
    const signals = mine.filter(e => e.event_type === 'agent.attempt_failed' || e.event_type === 'agent.progress');
    const latest = signals[signals.length - 1];
    if (latest?.event_type === 'agent.attempt_failed') {
      const attempt = Number(latest.attempt ?? 1) + 1;
      const maxAttempts = latest.max_attempts ? Number(latest.max_attempts) : undefined;
      return { ...base, step: 'repairing', attempt, maxAttempts, note: shortError(latest.error, 160) };
    }
    if (latest?.event_type === 'agent.progress' && (latest.phase === 'checking' || latest.phase === 'acting')) {
      return { ...base, step: latest.phase };
    }
    return { ...base, step: 'working' };
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** The live view of a run: the given one, or the mission's latest. Null when the mission isn't this tenant's. */
export async function loadLiveRun(tenantId: string, missionId: string, runId?: string | null): Promise<LiveRunView | null> {
  const supabase = createServiceClient();

  const { data: mission } = await supabase
    .from('missions')
    .select('id, title, status, mission_json, training_enabled, training_graduated_at')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!mission) return null;

  const mj = (mission.mission_json ?? {}) as { title?: string; agents?: Array<{ id: string; role: string; agentIndex?: number; pythonScript?: string }>; permissions?: Array<{ service?: string; type?: string }> };
  // Which app each agent works in and how to show it: the mission's own blueprint (its apps and
  // each agent's declared tools) resolved against Composio's catalog.
  const catalog = await missionCatalog(mj, declaredActions(mj));
  const toolkits = Object.keys(catalog.apps);
  const blueprintAgents = [...(mj.agents ?? [])]
    .sort((a, b) => (a.agentIndex ?? 0) - (b.agentIndex ?? 0))
    .map(a => ({ id: a.id, role: a.role, apps: catalog.agentApps[a.id] ?? appsInScript(a.pythonScript ?? '', toolkits) }));

  const runQuery = supabase
    .from('mission_runs')
    .select('id, run_number, trigger, status, started_at, completed_at, duration_ms, agents_total, agents_done, agents_failed, summary')
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId);
  const { data: runRow } = runId
    ? await runQuery.eq('id', runId).maybeSingle()
    : await runQuery.order('started_at', { ascending: false }).limit(1).maybeSingle();

  const { data: recent } = await supabase
    .from('mission_runs')
    .select('duration_ms')
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .eq('status', 'completed')
    .not('duration_ms', 'is', null)
    .order('started_at', { ascending: false })
    .limit(6);
  const typicalMs = median((recent ?? []).map(r => r.duration_ms as number).filter(n => n > 0));

  const view: LiveRunView = {
    mission: {
      id: mission.id,
      title: mission.title || mj.title || 'Mission',
      status: mission.status,
      rehearsal: mission.training_enabled === true,
    },
    run: null,
    agents: blueprintAgents.map(a => ({ ...a, step: 'waiting' as AgentStep })),
    approval: null,
    apps: Object.fromEntries(Object.values(catalog.apps).map(a => [a.slug, { name: a.name, logo: a.logo }])),
    typicalMs,
    serverTime: new Date().toISOString(),
  };
  if (!runRow) return view;

  const status = (['queued', 'running', 'paused', 'completed', 'failed'].includes(runRow.status) ? runRow.status : 'running') as RunStatus;

  // Only the small fields — agent outputs can be large and this is polled every couple of seconds.
  const { data: events } = await supabase
    .from('events')
    .select('event_type, entity_id, created_at, attempt:payload->>attempt, max_attempts:payload->>maxAttempts, error:payload->>error, phase:payload->>phase')
    .eq('tenant_id', tenantId)
    .eq('run_id', runRow.id)
    .in('event_type', ['agent.started', 'agent.completed', 'agent.attempt_failed', 'agent.progress', 'mission.failed'])
    .order('created_at', { ascending: true })
    .limit(500);
  const rows = (events ?? []) as RunEventRow[];
  const runError = rows.filter(e => e.event_type === 'mission.failed').pop()?.error ?? null;

  let approval: LiveApproval | null = null;
  if (status === 'paused' || status === 'running') {
    const { data: pending } = await supabase
      .from('proposed_actions')
      .select('id, mission_id, agent_id, agent_role, mission_title, action_type, status, submitted_at, payload_redacted, run_id:payload->>runId')
      .eq('tenant_id', tenantId)
      .eq('mission_id', missionId)
      .eq('status', 'pending')
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pending && (!pending.run_id || pending.run_id === runRow.id)) {
      const a = describeApproval({ ...(pending as ProposedActionRow), payload: { runId: pending.run_id } }, slug => actionLabel(slug, catalog), 600);
      approval = { id: a.id, agentId: a.agentId, agentRole: a.agentRole, kind: a.kind, actions: a.actions, preview: a.preview || undefined, submittedAt: a.submittedAt };
    }
  }

  const mode = runMode(runRow, mission);
  view.run = {
    id: runRow.id,
    number: runRow.run_number,
    status,
    mode,
    trigger: runRow.trigger ?? 'manual',
    startedAt: runRow.started_at,
    completedAt: runRow.completed_at,
    durationMs: runRow.duration_ms,
    agentsTotal: runRow.agents_total ?? blueprintAgents.length,
    agentsDone: runRow.agents_done ?? 0,
    agentsFailed: runRow.agents_failed ?? 0,
    error: status === 'failed' ? shortError(runError ?? runRow.summary) : undefined,
    summary: runRow.summary ? String(runRow.summary).replace(REHEARSAL_PREFIX, '').slice(0, 400) : undefined,
    credits: await import('@/lib/middleware/billing').then(b => b.creditsChargedFor(tenantId, { runId: runRow.id })).catch(() => undefined),
  };
  view.agents = deriveAgents({ agents: blueprintAgents, events: rows, runStatus: status, approvalAgentId: approval?.agentId, runError: runError ?? (status === 'failed' ? runRow.summary : null) });
  view.approval = approval;
  return view;
}
