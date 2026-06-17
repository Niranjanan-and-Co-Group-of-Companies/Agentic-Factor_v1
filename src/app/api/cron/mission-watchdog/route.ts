import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/cron/mission-watchdog
//
// Finds missions stuck in "active" status beyond the maximum
// allowed runtime and marks them as failed.
//
// Schedule this in vercel.json:
//   { "path": "/api/cron/mission-watchdog", "schedule": "*/10 * * * *" }
//
// Requires Authorization: Bearer <CRON_SECRET> header.
// ============================================================

export const maxDuration = 30;

const MAX_RUNTIME_MINUTES = 25;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - MAX_RUNTIME_MINUTES * 60 * 1000).toISOString();

  // Find missions that have been "active" for longer than MAX_RUNTIME_MINUTES
  const { data: stuckMissions, error } = await supabase
    .from('missions')
    .select('id, tenant_id, title, updated_at')
    .eq('status', 'active')
    .lt('updated_at', cutoff);

  if (error) {
    console.error('[Watchdog] Failed to query stuck missions:', error);
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 });
  }

  if (!stuckMissions || stuckMissions.length === 0) {
    return NextResponse.json({ checked: true, stuck: 0 });
  }

  console.log(`[Watchdog] Found ${stuckMissions.length} stuck mission(s)`);

  const results: Array<{ id: string; title: string; action: string }> = [];

  for (const mission of stuckMissions) {
    try {
      const report = {
        failedAt: 'Watchdog',
        errorType: 'timeout',
        error: `Mission exceeded maximum runtime of ${MAX_RUNTIME_MINUTES} minutes. The execution environment may have crashed or been interrupted.`,
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

      await supabase.from('events').insert({
        tenant_id: mission.tenant_id,
        event_type: 'mission.failed',
        entity_type: 'mission',
        entity_id: mission.id,
        payload: report,
      });

      results.push({ id: mission.id, title: mission.title, action: 'marked_failed' });
      console.log(`[Watchdog] Marked mission ${mission.id} ("${mission.title}") as failed — exceeded ${MAX_RUNTIME_MINUTES}min runtime`);
    } catch (err) {
      console.error(`[Watchdog] Failed to update mission ${mission.id}:`, err);
      results.push({ id: mission.id, title: mission.title, action: 'error' });
    }
  }

  return NextResponse.json({ checked: true, stuck: stuckMissions.length, results });
}
