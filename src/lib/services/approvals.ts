import { circuitBreaker } from '@/lib/services/circuit-breaker';
import { createServiceClient } from '@/lib/supabase/server';
import { approvalActionSlugs, recordDecisionInChat, recordFromRow, type ApprovalRecordPayload, type ApprovalVia, type ProposedActionRow } from '@/lib/services/approval-records';
import { missionActionLabeler } from '@/lib/services/app-catalog';

// ============================================================
// Shared approval-decision processing — used by both the
// button-based /api/approvals route and the conversational
// Chief of Staff chat, so there is exactly one place that knows
// how to actually approve or reject a proposed action.
// Every decision is also saved into the mission's chat, with the
// reason and where it was made, so the mission keeps the record.
// ============================================================

export type ApprovalResult =
  | { ok: true; actionId: string; decision: 'approved' | 'rejected'; missionId?: string; circuitState: string; record?: ApprovalRecordPayload }
  | { ok: false; reason: 'circuit_breaker'; circuitState: string; message: string }
  | { ok: false; reason: 'missing_permission'; providers: string[]; message: string }
  | { ok: false; reason: 'already_decided'; decision: 'approved' | 'rejected'; record: ApprovalRecordPayload | null; message: string }
  | { ok: false; reason: 'not_found'; message: string }
  | { ok: false; reason: 'error'; message: string };

type BlueprintPermissions = Array<{ type?: string; service?: string; scope?: string }>;

export interface DecisionContext {
  /** Why — optional for approvals, asked for on rejections. Kept with the record. */
  reason?: string;
  /** Where the decision was made. */
  via?: ApprovalVia;
  /** Who made it (their email). */
  decidedBy?: string;
}

const APPROVAL_COLUMNS = 'id, mission_id, agent_id, agent_role, target, action_type, status, submitted_at, mission_title, payload, payload_redacted';

export async function processApprovalDecision(
  tenantId: string,
  actionId: string,
  decision: 'approved' | 'rejected',
  missionIdHint?: string,
  context: DecisionContext = {},
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

    // The action itself (this tenant's only): its mission, what it asks for, and whether it is still open.
    const { data: actionData } = await supabase
      .from('proposed_actions')
      .select(APPROVAL_COLUMNS)
      .eq('id', actionId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!actionData) return { ok: false, reason: 'not_found', message: 'That approval no longer exists.' };

    const actualMissionId = actionData.mission_id as string | undefined;
    const { data: missionPerms } = actualMissionId
      ? await supabase.from('missions').select('permissions:mission_json->permissions').eq('id', actualMissionId).maybeSingle()
      : { data: null };
    // Official action titles for this approval, from the mission's own apps.
    const label = await missionActionLabeler({ permissions: (missionPerms as { permissions?: BlueprintPermissions } | null)?.permissions }, approvalActionSlugs(actionData as ProposedActionRow));

    // Decided already (another tab, the Command Center, a reply in chat): report it instead of deciding twice.
    if (actionData.status === 'approved' || actionData.status === 'rejected') {
      return {
        ok: false, reason: 'already_decided', decision: actionData.status,
        record: recordFromRow(actionData as ProposedActionRow, label),
        message: `This was already ${actionData.status}.`,
      };
    }

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

    // Decide it — only while it is still pending, so two places deciding at once can't both win.
    const decidedAt = new Date().toISOString();
    const reason = context.reason?.trim().slice(0, 1000) || undefined;
    const via: ApprovalVia = context.via ?? 'api';
    const { data: updated, error } = await supabase
      .from('proposed_actions')
      .update({
        status: decision,
        decided_by: tenantId,
        decided_at: decidedAt,
        payload: { ...(actionData.payload ?? {}), decision: { reason, via, by: context.decidedBy, at: decidedAt } },
      })
      .eq('id', actionId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .select('id');

    if (!error && (updated ?? []).length === 0) {
      const { data: now } = await supabase.from('proposed_actions').select(APPROVAL_COLUMNS).eq('id', actionId).maybeSingle();
      const settled = now?.status === 'approved' || now?.status === 'rejected' ? now.status : decision;
      return {
        ok: false, reason: 'already_decided', decision: settled,
        record: now ? recordFromRow(now as ProposedActionRow, label) : null,
        message: `This was already ${settled}.`,
      };
    }

    if (error) {
      console.warn('[approvals] DB update skipped:', error.message);
      return { ok: false, reason: 'error', message: 'Could not record the decision. Please try again.' };
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
        .update({ status: 'failed', completed_at: now, summary: `Stopped: the reviewer rejected a proposed action${reason ? ` — “${reason.slice(0, 300)}”` : ''}.` })
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
        payload: { actionId, agentRole: actionData?.agent_role, rejectedAt: now, reason },
      });
    }

    // The permanent record in the mission's chat — whichever screen the decision came from.
    const record = recordFromRow({ ...(actionData as ProposedActionRow), status: decision, payload: { ...(actionData.payload ?? {}), decision: { reason, via, by: context.decidedBy, at: decidedAt } } }, label) ?? undefined;
    if (record && actualMissionId) await recordDecisionInChat(supabase, tenantId, actualMissionId, record);

    return {
      ok: true,
      actionId,
      decision,
      missionId: actualMissionId,
      circuitState: circuitBreaker.getState(),
      record,
    };
  } catch (error) {
    console.error('[processApprovalDecision]', error);
    return { ok: false, reason: 'error', message: (error as Error).message };
  }
}

/** The signed-in person's email, for "decided by". */
export async function userEmail(userId: string): Promise<string | undefined> {
  try {
    const { data } = await createServiceClient().auth.admin.getUserById(userId);
    return data.user?.email ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * A decision the customer gave by replying in the mission chat (the assistant emitted an
 * approval_decision action). Applies it to the mission's pending approval, if there still is one.
 * `note` is a sentence to add to the reply when the decision could not be recorded as asked.
 */
export async function applyChatDecision(
  tenantId: string,
  missionId: string,
  userId: string,
  action: Record<string, unknown> | null,
): Promise<{ handled: boolean; record?: ApprovalRecordPayload; note?: string }> {
  if (action?.type !== 'approval_decision') return { handled: false };
  const decision = action.decision === 'approved' || action.decision === 'rejected' ? action.decision : null;
  if (!decision) return { handled: true };
  const { data: pending } = await createServiceClient()
    .from('proposed_actions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('mission_id', missionId)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pending) return { handled: true, note: 'Nothing is waiting for approval any more, so nothing was changed.' };
  const reason = typeof action.reason === 'string' && action.reason.trim() ? action.reason.trim() : undefined;
  const result = await processApprovalDecision(tenantId, pending.id, decision, missionId, {
    reason, via: 'chat_message', decidedBy: await userEmail(userId),
  });
  if (result.ok) return { handled: true, record: result.record };
  if (result.reason === 'already_decided') return { handled: true, record: result.record ?? undefined, note: result.message };
  if (result.reason === 'missing_permission') return { handled: true, note: `I couldn't approve it yet: connect ${result.providers.join(', ')} first, then tell me again.` };
  return { handled: true, note: 'I couldn’t record that decision. Please use the buttons on the approval card.' };
}
