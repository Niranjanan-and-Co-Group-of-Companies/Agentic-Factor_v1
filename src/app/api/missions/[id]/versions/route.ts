import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 15;

// GET /api/missions/[id]/versions — list version history for a mission
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const supabase = createServiceClient();

  // Verify access (owner or team member via RLS)
  const { data: mission } = await supabase
    .from('missions')
    .select('id, title, tenant_id')
    .eq('id', missionId)
    .single();

  if (!mission) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

  const { data: versions, error } = await supabase
    .from('mission_versions')
    .select('id, version_number, change_summary, created_at')
    .eq('mission_id', missionId)
    .eq('tenant_id', mission.tenant_id)
    .order('version_number', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ versions: versions ?? [], missionTitle: mission.title });
}

// POST /api/missions/[id]/versions/restore — restore a specific version
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const { versionId } = await request.json() as { versionId: string };
  if (!versionId) return NextResponse.json({ error: 'versionId is required' }, { status: 400 });

  const supabase = createServiceClient();

  // Only the owner can restore
  const { data: mission } = await supabase
    .from('missions')
    .select('id, title, tenant_id, status')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  if (!mission) return NextResponse.json({ error: 'Mission not found or access denied' }, { status: 404 });

  if (['active', 'building'].includes(mission.status)) {
    return NextResponse.json({ error: 'Cannot restore while mission is running. Pause it first.' }, { status: 409 });
  }

  // Fetch the target version
  const { data: targetVersion } = await supabase
    .from('mission_versions')
    .select('id, version_number, mission_json')
    .eq('id', versionId)
    .eq('mission_id', missionId)
    .single();

  if (!targetVersion) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  // Get next version number
  const { data: latestVersion } = await supabase
    .from('mission_versions')
    .select('version_number')
    .eq('mission_id', missionId)
    .order('version_number', { ascending: false })
    .limit(1)
    .single();

  const nextVersionNumber = (latestVersion?.version_number ?? 0) + 1;

  // Update the mission's blueprint
  const { error: updateError } = await supabase
    .from('missions')
    .update({
      mission_json: targetVersion.mission_json,
      updated_at: new Date().toISOString(),
    })
    .eq('id', missionId)
    .eq('tenant_id', tenantId);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Create a new version snapshot recording the restore
  await supabase.from('mission_versions').insert({
    mission_id: missionId,
    tenant_id: tenantId,
    version_number: nextVersionNumber,
    mission_json: targetVersion.mission_json,
    change_summary: `Restored from version ${targetVersion.version_number}`,
  });

  return NextResponse.json({
    success: true,
    restoredFrom: targetVersion.version_number,
    newVersion: nextVersionNumber,
  });
}
