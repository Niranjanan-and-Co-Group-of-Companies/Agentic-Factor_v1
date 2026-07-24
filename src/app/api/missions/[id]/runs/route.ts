import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/missions/:id/runs — Run history for a mission
//
// Returns rows from mission_runs (one per execution), plus an
// event-based check for whether an active schedule is set.
// ============================================================

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    const supabase = createServiceClient();

    // Fetch structured run records from mission_runs table
    const { data: runs, error } = await supabase
      .from('mission_runs')
      .select('id, run_number, trigger, status, started_at, completed_at, duration_ms, agents_total, agents_done, agents_failed, summary')
      .eq('mission_id', missionId)
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error(`[GET /api/missions/${missionId}/runs] Error:`, error.message);
      return NextResponse.json({ runs: [], hasActiveSchedule: false });
    }

    // Check if there's an active schedule via events table
    const { data: scheduleEvents } = await supabase
      .from('events')
      .select('event_type, payload, created_at')
      .eq('entity_id', missionId)
      .eq('tenant_id', tenantId)
      .in('event_type', ['mission.wait', 'mission.unscheduled'])
      .order('created_at', { ascending: false })
      .limit(5);

    const hasActiveSchedule = (scheduleEvents || []).some(
      (r) => r.event_type === 'mission.wait' && r.payload?.action === 'schedule'
    );

    return NextResponse.json({ runs: runs || [], hasActiveSchedule });

  } catch (error) {
    console.error(`[GET /api/missions/${missionId}/runs] Error:`, error);
    return NextResponse.json({ runs: [], hasActiveSchedule: false });
  }
}
