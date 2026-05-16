import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { buildTeam, getMissionAgents } from '@/lib/services/orchestrator';
import { createServiceClient } from '@/lib/supabase/server';
import { MissionSchema } from '@/lib/schemas/mission';
import { z } from 'zod';

// ============================================================
// Request validation
// ============================================================
const BuildTeamRequest = z.object({
  missionId: z.string().uuid(),
});

// ============================================================
// POST /api/agents — Build and provision an agent team for a mission
// Security: Wrapped in auth.tenant_id() middleware. RLS enforced.
// ============================================================
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;

  const { tenantId } = authResult;

  try {
    const body = await request.json();
    const { missionId } = BuildTeamRequest.parse(body);

    // Fetch the mission
    const supabase = createServiceClient();
    const { data: missionRow, error } = await supabase
      .from('missions')
      .select('mission_json, status')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !missionRow) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    if (!['draft', 'pending_permissions'].includes(missionRow.status)) {
      return NextResponse.json(
        { error: `Mission cannot be built in status "${missionRow.status}"` },
        { status: 409 }
      );
    }

    // Parse and validate the mission JSON
    const mission = MissionSchema.parse(missionRow.mission_json);

    // Build the team
    const result = await buildTeam(mission, tenantId);

    return NextResponse.json(
      {
        success: true,
        graph: {
          pattern: result.graph.pattern,
          timeoutSeconds: result.graph.timeoutSeconds,
          agentCount: result.graph.agents.length,
          edgeCount: result.graph.edges.length,
          entryAgent: result.graph.entryAgentId,
        },
        dryRun: {
          success: result.dryRunReport.success,
          estimatedTokens: result.dryRunReport.totalEstimatedTokens,
          estimatedCostUsd: result.dryRunReport.totalEstimatedCostUsd,
          warnings: result.dryRunReport.warnings,
          errors: result.dryRunReport.errors,
        },
        snapshotVersion: result.snapshotVersion,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 }
      );
    }

    console.error('[POST /api/agents] Error:', error);
    return NextResponse.json(
      { error: 'Failed to build team', message: (error as Error).message },
      { status: 500 }
    );
  }
}

// ============================================================
// GET /api/agents?missionId=<uuid> — List agents for a mission
// Security: Wrapped in auth.tenant_id() middleware. RLS enforced.
// ============================================================
export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;

  const { tenantId } = authResult;

  const missionId = request.nextUrl.searchParams.get('missionId');
  if (!missionId) {
    return NextResponse.json(
      { error: 'missionId query parameter is required' },
      { status: 400 }
    );
  }

  try {
    const agents = await getMissionAgents(missionId, tenantId);

    return NextResponse.json({
      agents: agents.map((a) => ({
        id: a.id,
        role: a.role,
        agentIndex: a.agentIndex,
        status: a.status,
        capabilities: a.capabilities,
        requiresExternalData: a.requiresExternalData,
        hasResearchLog: a.hasResearchLog,
      })),
    });
  } catch (error) {
    console.error('[GET /api/agents] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agents', message: (error as Error).message },
      { status: 500 }
    );
  }
}

// ============================================================
// PATCH /api/agents — Update agent trust level
// Body: { agentId: uuid, trustLevel: "manual" | "conditional" | "autonomous" }
// ============================================================
const PatchAgentSchema = z.object({
  agentId: z.string().uuid(),
  trustLevel: z.enum(['manual', 'conditional', 'autonomous']),
});

export async function PATCH(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const body = await request.json();
    const { agentId, trustLevel } = PatchAgentSchema.parse(body);

    const supabase = createServiceClient();

    // Verify ownership: agent must belong to this tenant
    const { data: agent } = await supabase
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('tenant_id', tenantId)
      .single();

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Update trust level in DB
    const { error } = await supabase
      .from('agents')
      .update({ trust_level: trustLevel })
      .eq('id', agentId);

    if (error) {
      throw new Error(`Failed to update trust level: ${error.message}`);
    }

    return NextResponse.json({ success: true, agentId, trustLevel });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 });
    }
    console.error('[PATCH /api/agents] Error:', error);
    return NextResponse.json({ error: 'Failed to update agent', message: (error as Error).message }, { status: 500 });
  }
}
