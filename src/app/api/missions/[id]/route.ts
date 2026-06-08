import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { transitionMissionStatus } from '@/lib/services/orchestrator';

// ============================================================
// PATCH /api/missions/:id — Status transitions (pause/resume/cancel)
// DELETE /api/missions/:id — Soft-delete a mission
// ============================================================

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    const { action, scheduleConfig } = await request.json();
    const supabase = createServiceClient();

    // Validate the mission exists and belongs to the tenant
    const { data: mission, error: missionError } = await supabase
      .from('missions')
      .select('status')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();

    if (missionError || !mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    const currentStatus = mission.status;

    // State transition validation
    const allowedTransitions: Record<string, string[]> = {
      pause: ['active', 'building'],
      resume: ['paused', 'deadlocked'],
      cancel: ['active', 'building', 'paused', 'draft', 'pending_permissions', 'pending_validation', 'pending_approval', 'deadlocked'],
      schedule: ['completed', 'paused', 'draft', 'failed'],
      unschedule: ['paused'],
    };

    if (!allowedTransitions[action]) {
      return NextResponse.json({ error: `Invalid action: ${action}. Allowed: pause, resume, cancel, schedule, unschedule` }, { status: 400 });
    }

    if (!allowedTransitions[action].includes(currentStatus)) {
      return NextResponse.json({ 
        error: `Cannot ${action} a mission with status '${currentStatus}'. Allowed from: ${allowedTransitions[action].join(', ')}` 
      }, { status: 409 });
    }

    const statusMap: Record<string, string> = {
      pause: 'paused',
      resume: 'active',
      cancel: 'failed',
      schedule: 'paused',
      unschedule: 'paused',
    };

    // ── Schedule: Set a recurring cron schedule ──
    if (action === 'schedule') {
      if (!scheduleConfig) {
        return NextResponse.json({ error: 'scheduleConfig is required for schedule action' }, { status: 400 });
      }

      // Remove any existing wait event for this mission first
      await supabase.from('events').delete()
        .eq('entity_id', missionId).eq('event_type', 'mission.wait');

      // Create the wait event for the cron scheduler to pick up
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'mission.wait',
        entity_type: 'mission',
        entity_id: missionId,
        payload: { action: 'schedule', config: scheduleConfig },
      });

      // Log the schedule event
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'mission.scheduled',
        entity_type: 'mission',
        entity_id: missionId,
        payload: { scheduleConfig, scheduledAt: new Date().toISOString() },
      });
    }

    // ── Unschedule: Remove recurring schedule ──
    if (action === 'unschedule') {
      await supabase.from('events').delete()
        .eq('entity_id', missionId).eq('event_type', 'mission.wait');

      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'mission.unscheduled',
        entity_type: 'mission',
        entity_id: missionId,
        payload: { unscheduledAt: new Date().toISOString() },
      });
    }

    const newStatus = statusMap[action];

    // If cancelling, also terminate all running agents and expire pending actions
    if (action === 'cancel') {
      // Terminate running/spawning agents
      await supabase
        .from('agents')
        .update({ status: 'terminated' })
        .eq('mission_id', missionId)
        .eq('tenant_id', tenantId)
        .in('status', ['running', 'spawning', 'paused']);

      // Expire pending actions
      await supabase
        .from('proposed_actions')
        .update({ status: 'expired', decided_at: new Date().toISOString() })
        .eq('mission_id', missionId)
        .eq('tenant_id', tenantId)
        .eq('status', 'pending');

      // Log cancellation event
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'mission.cancelled',
        entity_type: 'mission',
        entity_id: missionId,
        payload: { previousStatus: currentStatus, cancelledAt: new Date().toISOString() },
      });
    }

    await transitionMissionStatus(missionId, tenantId, newStatus as any);

    return NextResponse.json({ 
      success: true, 
      action, 
      previousStatus: currentStatus, 
      newStatus,
      message: `Mission ${action}d successfully.` 
    });

  } catch (error) {
    console.error(`[PATCH /api/missions/${missionId}] Error:`, error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    const supabase = createServiceClient();

    // Verify ownership
    const { data: mission, error: missionError } = await supabase
      .from('missions')
      .select('id, status')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();

    if (missionError || !mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    // Don't allow deleting active/running missions
    if (['active', 'building'].includes(mission.status)) {
      return NextResponse.json({ 
        error: 'Cannot delete an active mission. Cancel it first.' 
      }, { status: 409 });
    }

    // Soft delete: mark as deleted (we could add a 'deleted' status or hard-delete)
    // For now, we hard-delete since Supabase cascades handle the cleanup
    const { error: deleteError } = await supabase
      .from('missions')
      .delete()
      .eq('id', missionId)
      .eq('tenant_id', tenantId);

    if (deleteError) {
      throw new Error(`Delete failed: ${deleteError.message}`);
    }

    return NextResponse.json({ success: true, message: 'Mission deleted.' });

  } catch (error) {
    console.error(`[DELETE /api/missions/${missionId}] Error:`, error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
