import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { circuitBreaker } from '@/lib/services/circuit-breaker';
import { processApprovalDecision, userEmail } from '@/lib/services/approvals';
import { approvalActionSlugs, describeApproval, recordFromRow, type ProposedActionRow } from '@/lib/services/approval-records';
import { missionActionLabeler } from '@/lib/services/app-catalog';
import { z } from 'zod';

// ============================================================
// /api/approvals — approvals happen in the chat (mission chat
// and Command Center). Decision logic lives in
// lib/services/approvals.ts, which also saves every decision,
// with its reason, into the mission's chat.
// ============================================================

const DecisionSchema = z.object({
  actionId: z.string(),
  decision: z.enum(['approved', 'rejected']),
  missionId: z.string().optional(),
  reason: z.string().max(1000).optional(),
  via: z.enum(['mission_chat', 'command_center', 'chat_message', 'approvals_page', 'api']).optional(),
});

const COLUMNS = 'id, mission_id, agent_id, agent_role, mission_title, action_type, status, submitted_at, payload, payload_redacted';

// POST /api/approvals — approve or reject, with an optional reason
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId, userId } = authResult;

  try {
    const body = await request.json();
    const { actionId, decision, missionId, reason, via } = DecisionSchema.parse(body);

    const result = await processApprovalDecision(tenantId, actionId, decision, missionId, {
      reason, via: via ?? 'api', decidedBy: await userEmail(userId),
    });

    if (!result.ok) {
      if (result.reason === 'circuit_breaker') {
        return NextResponse.json(
          { error: 'Circuit breaker OPEN', reason: result.message, circuitState: result.circuitState },
          { status: 429 }
        );
      }
      if (result.reason === 'missing_permission') {
        return NextResponse.json(
          { error: 'missing_permission', providers: result.providers, message: `Connect ${result.providers.join(', ')} first, then approve again.` },
          { status: 403 }
        );
      }
      if (result.reason === 'already_decided') {
        return NextResponse.json({ error: 'already_decided', message: result.message, decision: result.decision, record: result.record }, { status: 409 });
      }
      if (result.reason === 'not_found') {
        return NextResponse.json({ error: 'not_found', message: result.message }, { status: 404 });
      }
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      actionId: result.actionId,
      decision: result.decision,
      record: result.record,
      circuitState: result.circuitState,
      usage: circuitBreaker.getUsage(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 });
    }
    console.error('[POST /api/approvals]', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// GET /api/approvals?pending=1   — approvals waiting on this workspace (Command Center)
// GET /api/approvals?id=<action> — one approval in full, with its decision record once decided
// GET /api/approvals             — circuit breaker status (internal)
export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const params = request.nextUrl.searchParams;
  const supabase = createServiceClient();

  // Official action titles, per mission, for the approvals being shown.
  const labelersFor = async (rows: ProposedActionRow[]) => {
    const ids = [...new Set(rows.map(r => r.mission_id))].filter(Boolean);
    const { data } = ids.length
      ? await supabase.from('missions').select('id, permissions:mission_json->permissions').in('id', ids).eq('tenant_id', tenantId)
      : { data: [] };
    const perms = new Map((data ?? []).map(m => [m.id as string, (m as { permissions?: Array<{ type?: string; service?: string; scope?: string }> }).permissions]));
    const entries = await Promise.all(ids.map(async id => [id, await missionActionLabeler(
      { permissions: perms.get(id) }, rows.filter(r => r.mission_id === id).flatMap(approvalActionSlugs),
    )] as const));
    return new Map(entries);
  };

  const id = params.get('id');
  if (id) {
    const { data: row } = await supabase.from('proposed_actions').select(COLUMNS).eq('id', id).eq('tenant_id', tenantId).maybeSingle();
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const label = (await labelersFor([row as ProposedActionRow])).get(row.mission_id);
    return NextResponse.json({
      approval: describeApproval(row as ProposedActionRow, label, 12_000),
      record: recordFromRow(row as ProposedActionRow, label),
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (params.get('pending')) {
    const { data: rows } = await supabase
      .from('proposed_actions')
      .select(COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('submitted_at', { ascending: false })
      .limit(20);
    const labels = await labelersFor((rows ?? []) as ProposedActionRow[]);
    return NextResponse.json({
      approvals: (rows ?? []).map(r => describeApproval(r as ProposedActionRow, labels.get(r.mission_id), 600)),
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({
    circuitState: circuitBreaker.getState(),
    usage: circuitBreaker.getUsage(),
  });
}
