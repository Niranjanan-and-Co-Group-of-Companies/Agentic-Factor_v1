import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/cron/mission-watchdog
//
// Finds missions stuck in "active" status beyond their allowed runtime
// and marks them — and their stuck agents and pending actions — as
// failed/expired, so nothing is left in a stale "running"/"pending" state
// forever. This is the serverless-safe replacement for the old
// setInterval-based deadlock detector, which never reliably ran in
// production (Vercel function instances don't stay alive for a timer to
// keep firing — that pattern only worked in a long-lived local dev server).
//
// Schedule this in vercel.json:
//   { "path": "/api/cron/mission-watchdog", "schedule": "*/10 * * * *" }
//
// Requires Authorization: Bearer <CRON_SECRET> header.
// ============================================================

export const maxDuration = 30;

// Used when a mission doesn't specify its own orchestration.timeoutSeconds
const DEFAULT_MAX_RUNTIME_SECONDS = 25 * 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Fetch all active missions — per-mission timeout means we can't filter
  // by a single cutoff in the query itself, so this is evaluated in code.
  const { data: activeMissions, error } = await supabase
    .from('missions')
    .select('id, tenant_id, title, updated_at, mission_json')
    .eq('status', 'active');

  if (error) {
    console.error('[Watchdog] Failed to query active missions:', error);
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 });
  }

  const now = Date.now();
  const stuckMissions = (activeMissions || []).filter((mission) => {
    const timeoutSeconds = mission.mission_json?.orchestration?.timeoutSeconds || DEFAULT_MAX_RUNTIME_SECONDS;
    const idleMs = now - new Date(mission.updated_at).getTime();
    return idleMs > timeoutSeconds * 1000;
  });

  if (stuckMissions.length === 0) {
    return NextResponse.json({ checked: true, stuck: 0 });
  }

  console.log(`[Watchdog] Found ${stuckMissions.length} stuck mission(s)`);

  const results: Array<{ id: string; title: string; action: string }> = [];

  for (const mission of stuckMissions) {
    try {
      const timeoutSeconds = mission.mission_json?.orchestration?.timeoutSeconds || DEFAULT_MAX_RUNTIME_SECONDS;
      const report = {
        failedAt: 'Watchdog',
        errorType: 'timeout',
        error: `Mission exceeded its maximum runtime of ${Math.round(timeoutSeconds / 60)} minutes. The execution environment may have crashed or been interrupted.`,
        actionStep: 'Click "Resume from Failed Agent" to retry from where it stopped, or "Fresh Start" to re-run all agents.',
        detectedAt: new Date().toISOString(),
        lastUpdated: mission.updated_at,
      };

      await supabase
        .from('missions')
        .update({
          status: 'failed',
          validation_report: report,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mission.id)
        .eq('tenant_id', mission.tenant_id);

      // Stuck agents previously stayed at "running"/"spawning"/"paused"
      // forever once their mission was marked failed — nothing ever closed
      // them out. Close them out here, alongside the mission.
      await supabase
        .from('agents')
        .update({ status: 'failed' })
        .eq('mission_id', mission.id)
        .eq('tenant_id', mission.tenant_id)
        .in('status', ['running', 'spawning', 'paused']);

      // Any approval still waiting on a human is moot now — the mission
      // that would have resumed from it is dead.
      await supabase
        .from('proposed_actions')
        .update({ status: 'expired', decided_at: new Date().toISOString() })
        .eq('mission_id', mission.id)
        .eq('tenant_id', mission.tenant_id)
        .eq('status', 'pending');

      await supabase.from('events').insert({
        tenant_id: mission.tenant_id,
        event_type: 'mission.failed',
        entity_type: 'mission',
        entity_id: mission.id,
        payload: report,
      });

      results.push({ id: mission.id, title: mission.title, action: 'marked_failed' });
      console.log(`[Watchdog] Marked mission ${mission.id} ("${mission.title}") as failed — exceeded ${Math.round(timeoutSeconds / 60)}min runtime`);
    } catch (err) {
      console.error(`[Watchdog] Failed to update mission ${mission.id}:`, err);
      results.push({ id: mission.id, title: mission.title, action: 'error' });
    }
  }

  return NextResponse.json({ checked: true, stuck: stuckMissions.length, results });
}
