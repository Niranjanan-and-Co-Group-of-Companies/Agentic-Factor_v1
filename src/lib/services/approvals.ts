import { circuitBreaker } from '@/lib/services/circuit-breaker';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// Shared approval-decision processing — used by both the
// button-based /api/approvals route and the conversational
// Chief of Staff chat, so there is exactly one place that knows
// how to actually approve or reject a proposed action.
// ============================================================

export type ApprovalResult =
  | { ok: true; actionId: string; decision: 'approved' | 'rejected'; missionId?: string; circuitState: string }
  | { ok: false; reason: 'circuit_breaker'; circuitState: string; message: string }
  | { ok: false; reason: 'missing_permission'; providers: string[]; message: string }
  | { ok: false; reason: 'error'; message: string };

export async function processApprovalDecision(
  tenantId: string,
  actionId: string,
  decision: 'approved' | 'rejected',
  missionIdHint?: string
): Promise<ApprovalResult> {
  try {
    // ── Circuit breaker check ──
    if (decision === 'approved') {
      const cbCheck = circuitBreaker.recordUsage(
        missionIdHint || actionId,
        100, // estimated tokens for this action
        0.001 // estimated cost
      );
      if (!cbCheck.allowed) {
        return {
          ok: false,
          reason: 'circuit_breaker',
          circuitState: circuitBreaker.getState(),
          message: cbCheck.reason || 'Circuit breaker is open.',
        };
      }
    }

    const supabase = createServiceClient();

    // Find the mission_id first since the frontend might pass the title.
    // Also grab the fields needed to compute this action's pattern key.
    const { data: actionData } = await supabase
      .from('proposed_actions')
      .select('mission_id, agent_id, agent_role, target, action_type')
      .eq('id', actionId)
      .single();

    const actualMissionId = actionData?.mission_id;

    // If approving, check if we have the required tokens BEFORE updating the DB
    if (decision === 'approved' && actualMissionId) {
      const { verifyMissionPermissions } = await import('@/lib/services/oauth-refresher');
      const missingProviders = await verifyMissionPermissions(actualMissionId, tenantId);

      if (missingProviders.length > 0) {
        return {
          ok: false,
          reason: 'missing_permission',
          providers: missingProviders,
          message: `Missing permissions for: ${missingProviders.join(', ')}`,
        };
      }
    }

    // Update the proposed_action status in the DB
    const { error } = await supabase
      .from('proposed_actions')
      .update({
        status: decision,
        decided_by: tenantId,
        decided_at: new Date().toISOString(),
      })
      .eq('id', actionId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.warn('[approvals] DB update skipped:', error.message);
    } else {
      // Log this decision against its action-pattern — the data foundation
      // for eventually letting an agent graduate to autonomous for a
      // specific, consistently-approved kind of action. A pattern key is
      // tenant + agent role + target service, since agents aren't yet
      // reusable templates with a stable identity of their own.
      const patternKey = `${tenantId}:${(actionData?.agent_role || 'unknown').toLowerCase()}:${(actionData?.target || 'unknown').toLowerCase()}`;
      const { error: historyErr } = await supabase.from('approval_history').insert({
        tenant_id: tenantId,
        proposed_action_id: actionId,
        agent_id: actionData?.agent_id,
        mission_id: actualMissionId,
        pattern_key: patternKey,
        agent_role: actionData?.agent_role,
        action_type: actionData?.action_type,
        decision,
      });
      if (historyErr) console.warn('[approvals] approval_history insert skipped:', historyErr.message);
    }

    // If approved, continue the paused run. This must go through Inngest: an un-awaited
    // promise is frozen as soon as this serverless request returns, so the resume never ran.
    // Reusing the paused runId lets completed agents return their cached output.
    //
    // Never start a new run here. The run is only marked 'paused' after its agent step stops
    // retrying, so an approval can arrive while it still shows 'running'. Starting a fresh run
    // then executed everything twice. In that case the run itself picks up the decision: the
    // retrying step sees the approval, or the pause step resumes it (same event id, so Inngest
    // delivers only one resume).
    if (decision === 'approved' && actualMissionId) {
      const { data: pausedRun } = await supabase
        .from('mission_runs')
        .select('id')
        .eq('mission_id', actualMissionId)
        .eq('tenant_id', tenantId)
        .eq('status', 'paused')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pausedRun) {
        console.log(`[approvals] Action ${actionId} approved — resuming run ${pausedRun.id}.`);
        const { inngest } = await import('@/lib/inngest/client');
        await inngest.send({
          id: `resume-${actionId}`,
          name: 'mission.execute',
          data: { missionId: actualMissionId, tenantId, mode: 'resume', runId: pausedRun.id },
        });
      } else {
        console.log(`[approvals] Action ${actionId} approved — its run is still active and will pick up the decision.`);
      }
    }

    // A rejection used to leave the run 'paused' forever — invisible to the customer, and with
    // the scheduler skipping missions that have an unfinished run, it silently stopped schedules.
    if (decision === 'rejected' && actualMissionId) {
      const now = new Date().toISOString();
      await supabase
        .from('mission_runs')
        .update({ status: 'failed', completed_at: now, summary: 'Stopped: the reviewer rejected a proposed action.' })
        .eq('mission_id', actualMissionId)
        .eq('tenant_id', tenantId)
        .eq('status', 'paused');
      await supabase
        .from('missions')
        .update({ status: 'failed', updated_at: now })
        .eq('id', actualMissionId)
        .eq('tenant_id', tenantId);
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'mission.action_rejected',
        entity_type: 'mission',
        entity_id: actualMissionId,
        payload: { actionId, agentRole: actionData?.agent_role, rejectedAt: now },
      });
    }

    return {
      ok: true,
      actionId,
      decision,
      missionId: actualMissionId,
      circuitState: circuitBreaker.getState(),
    };
  } catch (error) {
    console.error('[processApprovalDecision]', error);
    return { ok: false, reason: 'error', message: (error as Error).message };
  }
}
