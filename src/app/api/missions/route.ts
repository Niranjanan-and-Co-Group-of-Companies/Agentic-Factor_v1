import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { generateMissionJSON, persistMission, editBlueprint } from '@/lib/services/intake';
import { buildTeam } from '@/lib/services/orchestrator';
import { createServiceClient } from '@/lib/supabase/server';
import { MissionSchema, LLMOutputSchema, type Mission } from '@/lib/schemas/mission';
import { z } from 'zod';

export const maxDuration = 300; // Blueprint generation can take 60-120s for complex missions

// ============================================================
// Request schemas
// ============================================================
const GenerateBlueprintRequest = z.object({
  intent: z.string().min(10, 'Intent must be at least 10 characters'),
});

const ConfirmBlueprintRequest = z.object({
  mission: z.record(z.string(), z.unknown()),
});

const EditBlueprintRequest = z.object({
  blueprint: z.record(z.string(), z.unknown()),
  instruction: z.string().min(2),
});

// ============================================================
// POST /api/missions — Two-phase flow:
//   ?action=blueprint  → Generate draft (NO DB writes)
//   ?action=confirm    → Persist + provision (user confirmed)
//   (default)          → Legacy single-step create
// ============================================================
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const action = request.nextUrl.searchParams.get('action') || 'create';

  try {
    const body = await request.json();

    // ── Phase 1: Generate Blueprint (NO persistence) ──
    if (action === 'blueprint') {
      const { checkCredits, deductCredits } = await import('@/lib/middleware/billing');
      const creditCheck = await checkCredits(tenantId, 1);
      if (!creditCheck.allowed) {
        return NextResponse.json({ error: creditCheck.reason }, { status: 402 });
      }

      const { intent } = GenerateBlueprintRequest.parse(body);
      const { mission, rawLLMOutput, isDiscovery, question } = await generateMissionJSON(intent, tenantId);
      
      // Deduct 1 credit for the LLM generation (only if not a discovery question)
      if (!isDiscovery) {
        await deductCredits(tenantId, 1, 'blueprint_generation').catch(() => {});
      }

      if (isDiscovery) {
        return NextResponse.json({
          success: true,
          phase: 'discovery',
          isDiscovery: true,
          question: question,
          message: question,
        });
      }
      if (!mission) {
        return NextResponse.json({ error: 'Blueprint generation returned empty. Please try again.' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        phase: 'blueprint',
        blueprint: mission,
        rawLLMOutput,
        meta: {
          agentCount: mission.agents.length,
          pattern: mission.orchestration.pattern,
          timeoutSeconds: mission.orchestration.timeoutSeconds,
          permissionsRequired: mission.permissions.filter((p) => !p.granted).length,
          validationChecks: mission.validationChecklist.length,
        },
        message: 'Blueprint generated. Review and edit before confirming.',
      });
    }

    // ── Phase 4.2: Edit Blueprint via Chat ──
    if (action === 'edit') {
      const { checkCredits, deductCredits } = await import('@/lib/middleware/billing');
      const creditCheck = await checkCredits(tenantId, 1);
      if (!creditCheck.allowed) {
        return NextResponse.json({ error: creditCheck.reason }, { status: 402 });
      }

      const { blueprint, instruction } = EditBlueprintRequest.parse(body);
      const parsedBlueprint = MissionSchema.parse(blueprint); // validate structure
      
      const updatedMission = await editBlueprint(parsedBlueprint as Mission, instruction);
      
      // Deduct 1 credit for the LLM generation
      await deductCredits(tenantId, 1, 'blueprint_edit').catch(() => {});
      
      return NextResponse.json({
        success: true,
        phase: 'blueprint',
        blueprint: updatedMission,
        message: 'Blueprint updated successfully.',
      });
    }

    // ── Phase 2: Confirm Blueprint (persist + provision) ──
    if (action === 'confirm') {
      const { mission: rawMission } = ConfirmBlueprintRequest.parse(body);
      const llmOutput = LLMOutputSchema.parse(rawMission);

      // ── Billing enforcement: credit-based checks ──
      const { checkCredits, checkActiveMissions } = await import('@/lib/middleware/billing');
      
      const creditCheck = await checkCredits(tenantId, 1);
      if (!creditCheck.allowed) {
        return NextResponse.json({ 
          error: 'plan_limit', 
          message: creditCheck.reason,
          plan: creditCheck.plan,
          creditsRemaining: creditCheck.creditsRemaining,
        }, { status: 402 });
      }

      const missionCheck = await checkActiveMissions(tenantId);
      if (!missionCheck.allowed) {
        return NextResponse.json({
          error: 'plan_limit',
          message: missionCheck.reason,
          plan: missionCheck.plan,
        }, { status: 402 });
      }

      // Hydrate server-generated fields that the UI doesn't send
      const now = new Date().toISOString();
      const genId = () => crypto.randomUUID();
      const mission: Mission = {
        ...llmOutput,
        id: genId(),
        tenantId,
        status: 'draft' as const,
        agents: llmOutput.agents.map((a, i) => ({
          ...a,
          id: a.id || genId(),
          systemPrompt: a.systemPrompt || `You are ${a.role}. Execute your assigned tasks.`,
          tools: a.tools.map(t => ({
            ...t,
            requiresAuth: t.requiresAuth ?? false,
            confidentialityLevel: t.confidentialityLevel ?? ('internal' as const),
          })),
        })),
        orchestration: {
          ...llmOutput.orchestration,
          entryAgent: llmOutput.orchestration.entryAgent || llmOutput.agents[0]?.id || genId(),
          edges: llmOutput.orchestration.edges || [],
        },
        createdAt: now,
        updatedAt: now,
      };

      // NOW persist — lazy execution only on confirm. 
      // This will return the mission with REAL database-generated UUIDs!
      const persistedMission = await persistMission(mission, tenantId);

      // Build the team using the true UUIDs
      const result = await buildTeam(persistedMission, tenantId);

      return NextResponse.json({
        success: true,
        phase: 'confirmed',
        graph: {
          pattern: result.graph.pattern,
          agentCount: result.graph.agents.length,
          edgeCount: result.graph.edges.length,
        },
        dryRun: {
          success: result.dryRunReport.success,
          estimatedTokens: result.dryRunReport.totalEstimatedTokens,
          estimatedCostUsd: result.dryRunReport.totalEstimatedCostUsd,
        },
        snapshotVersion: result.snapshotVersion,
      }, { status: 201 });
    }

    // ── Legacy: Single-step create (backward-compatible) ──
    const { intent } = GenerateBlueprintRequest.parse(body);
    const { mission } = await generateMissionJSON(intent, tenantId);
    if (!mission) {
      return NextResponse.json({ error: 'Mission generation failed' }, { status: 500 });
    }
    await persistMission(mission, tenantId);

    return NextResponse.json({ success: true, mission }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 });
    }

    const errMsg = (error as Error).message || 'Unknown error';
    console.error('[POST /api/missions] Error:', errMsg);

    // Surface specific error categories to the UI
    let userMessage = errMsg;
    let statusCode = 500;

    if (errMsg.includes('API key') || errMsg.includes('api_key') || errMsg.includes('401') || errMsg.includes('403')) {
      userMessage = `LLM Authentication Failed: ${errMsg}. Check your GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.`;
    } else if (errMsg.includes('No LLM provider')) {
      userMessage = 'No LLM provider configured. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in .env.local';
    } else if (errMsg.includes('JSON') || errMsg.includes('parse') || errMsg.includes('Unexpected token')) {
      userMessage = `LLM returned invalid JSON. The model may need a retry. Original error: ${errMsg}`;
    } else if (errMsg.includes('supabase') || errMsg.includes('relation') || errMsg.includes('PGRST')) {
      userMessage = `Database error: ${errMsg}. Ensure Supabase tables are created.`;
      statusCode = 503;
    } else if (errMsg.includes('fetch') || errMsg.includes('ECONNREFUSED') || errMsg.includes('network')) {
      userMessage = `Network error: ${errMsg}. Check your internet connection and API endpoints.`;
      statusCode = 503;
    }

    return NextResponse.json({ error: 'Blueprint generation failed', message: userMessage }, { status: statusCode });
  }
}

// ============================================================
// GET /api/missions — List all missions for the tenant
// ============================================================
export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const supabase = createServiceClient();
    const { data: missions, error } = await supabase
      .from('missions')
      .select('id, title, description, status, heartbeat_at, created_at, updated_at, validation_report')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({ missions });
  } catch (error) {
    console.error('[GET /api/missions] Error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
