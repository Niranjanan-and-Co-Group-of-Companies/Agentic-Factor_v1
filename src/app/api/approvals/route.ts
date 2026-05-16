import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { circuitBreaker } from '@/lib/services/circuit-breaker';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';

// ============================================================
// POST /api/approvals — Process approval decisions
// Connects the Approve/Reject buttons to the orchestrator
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

    // ── Circuit breaker check ──
    if (decision === 'approved') {
      const cbCheck = circuitBreaker.recordUsage(
        missionId || actionId,
        100, // estimated tokens for this action
        0.001 // estimated cost
      );
      if (!cbCheck.allowed) {
        return NextResponse.json({
          error: 'Circuit breaker OPEN',
          reason: cbCheck.reason,
          circuitState: circuitBreaker.getState(),
        }, { status: 429 });
      }
    }

    const supabase = createServiceClient();

    // Find the mission_id first since the frontend might pass the title
    const { data: actionData } = await supabase
      .from('proposed_actions')
      .select('mission_id')
      .eq('id', actionId)
      .single();

    const actualMissionId = actionData?.mission_id;

    // If approving, check if we have the required tokens BEFORE updating the DB
    if (decision === 'approved' && actualMissionId) {
      const { verifyMissionPermissions } = await import('@/lib/services/oauth-refresher');
      const missingProviders = await verifyMissionPermissions(actualMissionId, tenantId);
      
      if (missingProviders.length > 0) {
        return NextResponse.json(
          { 
            error: 'missing_permission', 
            providers: missingProviders,
            message: `Missing permissions for: ${missingProviders.join(', ')}`
          }, 
          { status: 403 }
        );
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
    }

    // If approved, signal the orchestrator to continue the agent
    if (decision === 'approved' && actualMissionId) {
      console.log(`[approvals] Action ${actionId} approved for mission ${actualMissionId}. Resuming execution...`);
      // Resume the paused agent via the orchestrator's execution loop asynchronously
      const { executeMission } = await import('@/lib/services/runtime/executor');
      executeMission(actualMissionId, tenantId).catch(err => {
        console.error(`[approvals] Failed to resume mission ${actualMissionId}:`, err);
      });
    }

    return NextResponse.json({
      success: true,
      actionId,
      decision,
      circuitState: circuitBreaker.getState(),
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
