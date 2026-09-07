import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 60;

// POST /api/missions/[id]/revert
// Body: { versionNumber: number }
// Restores mission_json from mission_versions snapshot.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    const { versionNumber } = await request.json() as { versionNumber?: number };
    if (!versionNumber || typeof versionNumber !== 'number') {
      return NextResponse.json({ error: 'versionNumber is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Fetch the version snapshot
    const { data: versionRow, error: vErr } = await supabase
      .from('mission_versions')
      .select('mission_json, version_number, change_summary')
      .eq('mission_id', missionId)
      .eq('tenant_id', tenantId)
      .eq('version_number', versionNumber)
      .single();

    if (vErr || !versionRow) {
      return NextResponse.json({ error: `Version ${versionNumber} not found` }, { status: 404 });
    }

    // Save a snapshot of the CURRENT blueprint before reverting (so the revert itself is undoable)
    try {
      const { data: latestVersion } = await supabase
        .from('mission_versions')
        .select('version_number')
        .eq('mission_id', missionId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const currentMission = await supabase
        .from('missions')
        .select('mission_json')
        .eq('id', missionId)
        .eq('tenant_id', tenantId)
        .single();

      if (currentMission.data?.mission_json) {
        await supabase.from('mission_versions').insert({
          mission_id: missionId,
          tenant_id: tenantId,
          version_number: (latestVersion?.version_number ?? 0) + 1,
          mission_json: currentMission.data.mission_json,
          change_summary: `Before revert to v${versionNumber}`,
        });
      }
    } catch { /* non-fatal */ }

    // Restore the version
    const { error: updateError } = await supabase
      .from('missions')
      .update({
        mission_json: versionRow.mission_json,
        updated_at: new Date().toISOString(),
      })
      .eq('id', missionId)
      .eq('tenant_id', tenantId);

    if (updateError) {
      return NextResponse.json({ error: 'Failed to restore version' }, { status: 500 });
    }

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

    const restoredTitle = (versionRow.mission_json as any)?.title;
    return NextResponse.json({
      success: true,
      versionNumber,
      title: restoredTitle,
      summary: versionRow.change_summary,
    });

  } catch (err) {
    console.error('[POST /api/missions/[id]/revert]', err);
    return NextResponse.json({ error: (err as Error).message ?? 'Revert failed' }, { status: 500 });
  }
}

// GET /api/missions/[id]/revert — list available versions
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const supabase = createServiceClient();
  const { data: versions, error } = await supabase
    .from('mission_versions')
    .select('version_number, change_summary, created_at')
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .order('version_number', { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 });
  }

  return NextResponse.json({ versions: versions ?? [] });
}
