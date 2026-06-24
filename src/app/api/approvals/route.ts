import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { circuitBreaker } from '@/lib/services/circuit-breaker';
import { processApprovalDecision } from '@/lib/services/approvals';
import { z } from 'zod';

// ============================================================
// POST /api/approvals — Process approval decisions
// Connects the Approve/Reject buttons to the orchestrator.
// Decision logic lives in lib/services/approvals.ts, shared with
// the conversational Chief of Staff approval flow.
// ============================================================

const DecisionSchema = z.object({
  actionId: z.string(),
  decision: z.enum(['approved', 'rejected']),
  missionId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const body = await request.json();
    const { actionId, decision, missionId } = DecisionSchema.parse(body);

    const result = await processApprovalDecision(tenantId, actionId, decision, missionId);

    if (!result.ok) {
      if (result.reason === 'circuit_breaker') {
        return NextResponse.json(
          { error: 'Circuit breaker OPEN', reason: result.message, circuitState: result.circuitState },
          { status: 429 }
        );
      }
      if (result.reason === 'missing_permission') {
        return NextResponse.json(
          { error: 'missing_permission', providers: result.providers, message: result.message },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      actionId: result.actionId,
      decision: result.decision,
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

// ============================================================
// GET /api/approvals — Get circuit breaker status
// ============================================================
export async function GET() {
  return NextResponse.json({
    circuitState: circuitBreaker.getState(),
    usage: circuitBreaker.getUsage(),
  });
}
