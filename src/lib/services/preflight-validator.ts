import { createServiceClient } from '@/lib/supabase/server';
import { verifyMissionPermissions } from './oauth-refresher';
import { checkCredits, CREDIT_COSTS } from '@/lib/middleware/billing';

export interface PreflightResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export async function runPreflightCheck(missionId: string, tenantId: string): Promise<PreflightResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const supabase = createServiceClient();

  // 1. Verify OAuth tokens — proactively refreshes expired ones, flags missing ones
  try {
    const missingProviders = await verifyMissionPermissions(missionId, tenantId);
    for (const provider of missingProviders) {
      blockers.push(
        `Missing OAuth token for "${provider}". Go to the Connectors page and reconnect it before running this mission.`
      );
    }
  } catch (e: any) {
    blockers.push(`Could not verify connector tokens: ${e.message}`);
  }

  // 2. Fetch mission to calculate estimated credit cost
  const { data: missionRow } = await supabase
    .from('missions')
    .select('mission_json')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  if (!missionRow) {
    blockers.push('Mission not found or not accessible. Please refresh the page.');
    return { ok: false, blockers, warnings };
  }

  const mission = missionRow.mission_json;
  const agentCount = (mission.agents || []).length;

  // 3. Estimated cost = agents × (E2B sandbox + LLM generation per agent)
  const estimatedCost = agentCount * (CREDIT_COSTS.code_execution + CREDIT_COSTS.llm_call_pro);
  const creditCheck = await checkCredits(tenantId, estimatedCost);
  if (!creditCheck.allowed) {
    blockers.push(
      `Insufficient credits. This mission needs ~${estimatedCost} credits ` +
      `(${agentCount} agents). ${creditCheck.reason}`
    );
  } else if ((creditCheck.creditsRemaining ?? 0) < estimatedCost * 1.5) {
    warnings.push(
      `Low credits: ~${estimatedCost} needed, ${creditCheck.creditsRemaining} remaining. ` +
      `Enough to run once but not to retry on failure.`
    );
  }

  // 4. LinkedIn posting requires "Share on LinkedIn" product approval — warn proactively
  const missionStr = JSON.stringify(mission).toLowerCase();
  const hasLinkedIn = missionStr.includes('linkedin_oidc') || missionStr.includes('"linkedin"');
  const isPosting = ['post', 'publish', 'share', 'ugcposts'].some(k => missionStr.includes(k));
  if (hasLinkedIn && isPosting) {
    warnings.push(
      'LinkedIn posting requires "Share on LinkedIn" product approval on your Developer App. ' +
      'If you see a 403 error, visit developer.linkedin.com → Your App → Products to apply (3–7 day review).'
    );
  }

  return { ok: blockers.length === 0, blockers, warnings };
}
