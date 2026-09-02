import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// POST /api/missions/[id]/update-blueprint
// Applies a natural-language change request to an existing mission blueprint.
// Uses editBlueprint() from intake.ts — the same LLM-driven validation pipeline
// as initial blueprint generation, but starting from the existing mission_json.
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    const { request: changeRequest } = await request.json() as { request?: string };
    if (!changeRequest?.trim()) {
      return NextResponse.json({ error: 'Change request is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Load existing mission
    const { data: missionRow, error: fetchError } = await supabase
      .from('missions')
      .select('mission_json, title')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !missionRow) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    // editBlueprint applies the instruction to the current blueprint JSON:
    // calls LLM, validates with LLMOutputSchema, normalizes permissions,
    // preserves agent UUIDs — same pipeline as initial generation.
    const { editBlueprint } = await import('@/lib/services/intake');
    const updatedMission = await editBlueprint(missionRow.mission_json as any, changeRequest.trim());

    // Strip vendor names from customer-visible title
    const { sanitizeTitle } = await import('@/lib/utils/sanitize-title');
    const newTitle = sanitizeTitle(updatedMission.title || (missionRow.title as string));

    // Persist updated blueprint
    const { error: updateError } = await supabase
      .from('missions')
      .update({
        mission_json: updatedMission as unknown as Record<string, unknown>,
        title: newTitle,
        updated_at: new Date().toISOString(),
      })
      .eq('id', missionId)
      .eq('tenant_id', tenantId);

    if (updateError) {
      console.error('[update-blueprint] DB update error:', updateError);
      return NextResponse.json({ error: 'Failed to save updated blueprint' }, { status: 500 });
    }

    // Refresh tool cache in background so tools reflect the new blueprint
    supabase
      .from('tenant_permissions')
      .select('provider')
      .eq('tenant_id', tenantId)
      .then(({ data: perms }) => {
        const connected = (perms ?? []).map(p => p.provider as string);
        import('@/lib/services/tool-registry').then(({ refreshMissionTools }) => {
          refreshMissionTools(tenantId, missionId, connected).catch(() => {});
        }).catch(() => {});
      });

    // Deduct credits for two LLM calls (generate + heal round in editBlueprint)
    import('@/lib/middleware/billing').then(({ deductCredits, CREDIT_COSTS }) => {
      deductCredits(tenantId, CREDIT_COSTS.llm_call_pro * 2, 'mission_update').catch(() => {});
    }).catch(() => {});

    return NextResponse.json({ success: true, title: newTitle, missionId });

  } catch (err) {
    console.error('[POST /api/missions/[id]/update-blueprint]', err);
    return NextResponse.json({ error: (err as Error).message ?? 'Update failed' }, { status: 500 });
  }
}
