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

    // If approved, signal the orchestrator to continue the agent
    if (decision === 'approved' && actualMissionId) {
      console.log(`[approvals] Action ${actionId} approved for mission ${actualMissionId}. Resuming execution...`);
      const { executeMission } = await import('@/lib/services/runtime/executor');
      executeMission(actualMissionId, tenantId).catch(err => {
        console.error(`[approvals] Failed to resume mission ${actualMissionId}:`, err);
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
