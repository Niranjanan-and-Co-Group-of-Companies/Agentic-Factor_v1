import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 60;

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

    // The edit runs as a background job (one step for the model's rewrite, one for validation):
    // rewriting every agent in this request ran past the 300s limit and nothing was saved. The page
    // follows it through the blueprint_step / blueprint_completed / blueprint_error events.
    const { inngest } = await import('@/lib/inngest/client');
    await inngest.send({
      name: 'mission/blueprint.edit',
      data: { missionId, tenantId, changeRequest, jobId, versionNumber: savedVersionNumber, connectedProviders },
    });

    return NextResponse.json({ success: true, async: true, jobId, missionId, versionNumber: savedVersionNumber }, { status: 202 });

  } catch (err) {
    console.error('[POST /api/missions/[id]/update-blueprint]', err);
    return NextResponse.json({ error: (err as Error).message ?? 'Update failed' }, { status: 500 });
  }
}
