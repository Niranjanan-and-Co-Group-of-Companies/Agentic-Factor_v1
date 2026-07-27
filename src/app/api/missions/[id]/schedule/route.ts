import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// PATCH /api/missions/:id/schedule
// Pause or resume a scheduled mission without deleting the schedule.
// Body: { paused: boolean }
// ============================================================

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const { paused } = await request.json() as { paused: boolean };
  if (typeof paused !== 'boolean') {
    return NextResponse.json({ error: 'Body must include { paused: boolean }' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('missions')
    .update({ schedule_paused: paused, updated_at: new Date().toISOString() })
    .eq('id', missionId)
    .eq('tenant_id', tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log event for audit trail
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: paused ? 'mission.schedule_paused' : 'mission.schedule_resumed',
    entity_type: 'mission',
    entity_id: missionId,
    payload: { paused },
  }).then(() => {}, () => {});

  return NextResponse.json({ ok: true, paused });
}

// GET — return current pause state + schedule info
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const supabase = createServiceClient();

  const { data: mission } = await supabase
    .from('missions')
    .select('schedule_paused')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  if (!mission) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

  // Get active schedule from events
  const { data: scheduleEvents } = await supabase
    .from('events')
    .select('event_type, payload, created_at')
    .eq('entity_id', missionId)
    .eq('tenant_id', tenantId)
    .in('event_type', ['mission.wait', 'mission.unscheduled'])
    .order('created_at', { ascending: false })
    .limit(5);

  const latestWait = (scheduleEvents ?? []).find(e => e.event_type === 'mission.wait' && (e.payload as Record<string, string>).action === 'schedule');

  return NextResponse.json({
    schedule_paused: mission.schedule_paused ?? false,
    schedule: latestWait?.payload ?? null,
  });
}
