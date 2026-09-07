import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    const body = await request.json() as { request?: string; jobId?: string };
    const changeRequest = body.request?.trim();
    const jobId = body.jobId ?? crypto.randomUUID();

    if (!changeRequest) {
      return NextResponse.json({ error: 'Change request is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Helper: emit a blueprint progress event via Supabase so the chat UI can subscribe
    const emitStep = async (step: string, label: string) => {
      try {
        await supabase.from('agent_execution_events').insert({
          session_id: jobId,
          tenant_id: tenantId,
          mission_id: missionId,
          chat_id: missionId, // no specific chat session — use missionId as scoping key
          event_type: 'blueprint_step',
          payload: { step, label },
        });
      } catch { /* non-fatal — UI falls back to polling */ }
    };

    const emitError = async (message: string) => {
      try {
        await supabase.from('agent_execution_events').insert({
          session_id: jobId,
          tenant_id: tenantId,
          mission_id: missionId,
          chat_id: missionId,
          event_type: 'blueprint_error',
          payload: { message },
        });
      } catch { /* non-fatal */ }
    };

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

    await emitStep('analysing', 'Analysing your change request…');

    // Fetch connected providers for Composio context injection
    const { data: perms } = await supabase
      .from('tenant_permissions')
      .select('provider, access_token')
      .eq('tenant_id', tenantId);
    const connectedProviders = (perms ?? [])
      .filter((r: { access_token: string }) => r.access_token === 'composio_managed')
      .map((r: { provider: string }) => r.provider);

    // Save a version snapshot BEFORE applying changes
    let savedVersionNumber: number | null = null;
    try {
      const { data: latestVersion } = await supabase
        .from('mission_versions')
        .select('version_number')
        .eq('mission_id', missionId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (latestVersion?.version_number ?? 0) + 1;
      const { error: versionError } = await supabase.from('mission_versions').insert({
        mission_id: missionId,
        tenant_id: tenantId,
        version_number: nextVersion,
        mission_json: missionRow.mission_json,
        change_summary: `Before: ${changeRequest.slice(0, 200)}`,
      });
      if (!versionError) {
        savedVersionNumber = nextVersion;
        console.log(`[update-blueprint] Saved version snapshot v${nextVersion} before edit`);
      }
    } catch (vErr) {
      console.warn('[update-blueprint] Version snapshot failed (non-fatal):', vErr);
    }

    // Run editBlueprint with the full validation pipeline + progress events
    const { editBlueprint } = await import('@/lib/services/intake');
    let updatedMission;
    try {
      updatedMission = await editBlueprint(
        missionRow.mission_json as any,
        changeRequest,
        tenantId,
        connectedProviders,
        emitStep
      );
    } catch (editErr) {
      await emitError((editErr as Error).message ?? 'Blueprint generation failed');
      throw editErr;
    }

    await emitStep('saving', 'Saving updated blueprint…');

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
      await emitError('Failed to save updated blueprint');
      return NextResponse.json({ error: 'Failed to save updated blueprint' }, { status: 500 });
    }

    // Emit completion event
    try {
      await supabase.from('agent_execution_events').insert({
        session_id: jobId,
        tenant_id: tenantId,
        mission_id: missionId,
        chat_id: missionId,
        event_type: 'blueprint_completed',
        payload: { title: newTitle, versionNumber: savedVersionNumber },
      });
    } catch { /* non-fatal */ }

    // Refresh tool cache in background
    supabase
      .from('tenant_permissions')
      .select('provider')
      .eq('tenant_id', tenantId)
      .then(({ data: p }) => {
        const connected = (p ?? []).map((r: { provider: string }) => r.provider);
        import('@/lib/services/tool-registry').then(({ refreshMissionTools }) => {
          refreshMissionTools(tenantId, missionId, connected).catch(() => {});
        }).catch(() => {});
      });

    // Deduct credits (generate + validation rounds)
    import('@/lib/middleware/billing').then(({ deductCredits, CREDIT_COSTS }) => {
      deductCredits(tenantId, CREDIT_COSTS.llm_call_pro * 3, 'mission_update').catch(() => {});
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      title: newTitle,
      missionId,
      versionNumber: savedVersionNumber,
    });

  } catch (err) {
    console.error('[POST /api/missions/[id]/update-blueprint]', err);
    return NextResponse.json({ error: (err as Error).message ?? 'Update failed' }, { status: 500 });
  }
}
