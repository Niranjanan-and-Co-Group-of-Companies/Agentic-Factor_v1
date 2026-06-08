import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/missions/:id/runs — Run history for a mission
// Returns cron wake events, completions, failures, schedule changes
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

    const { data: runs, error } = await supabase
      .from('events')
      .select('event_type, payload, created_at')
      .eq('entity_id', missionId)
      .eq('tenant_id', tenantId)
      .in('event_type', [
        'mission.resumed_by_cron',
        'mission.completed',
        'mission.failed',
        'mission.scheduled',
        'mission.unscheduled',
        'mission.cancelled',
        'mission.wait',
      ])
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error(`[GET /api/missions/${missionId}/runs] Error:`, error.message);
      return NextResponse.json({ runs: [] });
    }

    // Check if there's an active schedule (mission.wait with action=schedule, no newer unschedule)
    const hasActiveSchedule = (runs || []).some(
      (r) => r.event_type === 'mission.wait' && r.payload?.action === 'schedule'
    );

    return NextResponse.json({ runs: runs || [], hasActiveSchedule });

  } catch (error) {
    console.error(`[GET /api/missions/${missionId}/runs] Error:`, error);
    return NextResponse.json({ runs: [], hasActiveSchedule: false });
  }
}
