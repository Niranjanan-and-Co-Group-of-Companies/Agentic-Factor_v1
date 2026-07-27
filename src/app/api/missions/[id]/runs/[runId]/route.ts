import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/missions/:id/runs/:runId
// Run detail drilldown — returns the full event log for a
// specific run, plus agent-level output and timing breakdown.
// ============================================================

export const maxDuration = 15;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; runId: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId, runId } = await context.params;

  const supabase = createServiceClient();

  // Fetch the run itself
  const { data: run, error: runError } = await supabase
    .from('mission_runs')
    .select('id, run_number, trigger, status, started_at, completed_at, duration_ms, agents_total, agents_done, agents_failed, summary')
    .eq('id', runId)
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  // Fetch events for this run (within the run's time window, entity = mission)
  const startedAt = run.started_at;
  const completedAt = run.completed_at ?? new Date().toISOString();

  const { data: events } = await supabase
    .from('events')
    .select('id, event_type, entity_type, entity_id, payload, created_at')
    .eq('tenant_id', tenantId)
    .eq('entity_id', missionId)
    .gte('created_at', startedAt)
    .lte('created_at', completedAt)
    .order('created_at', { ascending: true })
    .limit(200);

  // Fetch agent-level events (entity_type = agent)
  const { data: agents } = await supabase
    .from('agents')
    .select('id, name, role, agent_index')
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .order('agent_index', { ascending: true });

  // Build per-agent output summary from events
  const agentOutputs: Record<string, { name: string; role: string; events: unknown[]; output?: string }> = {};
  for (const agent of agents ?? []) {
    agentOutputs[agent.id] = { name: agent.name, role: agent.role, events: [] };
  }

  const runEvents = (events ?? []).map(e => ({
    id: e.id,
    type: e.event_type,
    payload: e.payload,
    timestamp: e.created_at,
  }));

  // Extract agent outputs from events
  for (const e of events ?? []) {
    const payload = e.payload as Record<string, unknown>;
    if (e.event_type === 'agent.completed' && payload?.agentId && agentOutputs[payload.agentId as string]) {
      agentOutputs[payload.agentId as string].output = payload.output as string ?? payload.summary as string;
    }
  }

  // Credit usage for this run (from billing events)
  const { data: creditEvents } = await supabase
    .from('events')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('event_type', 'billing.credit_used')
    .gte('created_at', startedAt)
    .lte('created_at', completedAt);

  const creditsUsed = (creditEvents ?? []).reduce((sum, e) => {
    return sum + ((e.payload as Record<string, number>).amount ?? 0);
  }, 0);

  return NextResponse.json({
    run,
    events: runEvents,
    agents: Object.values(agentOutputs),
    creditsUsed,
    eventCount: runEvents.length,
  });
}
