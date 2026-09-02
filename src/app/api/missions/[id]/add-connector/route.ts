import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// POST /api/missions/[id]/add-connector
// Appends a newly-connected provider to mission_json.permissions so the
// mission blueprint stays in sync with what the customer has connected.
// Called automatically after OAuth popup close or API key save.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    const { provider, type = 'composio_oauth', scope = '' } = await request.json() as {
      provider?: string;
      type?: string;
      scope?: string;
    };

    if (!provider?.trim()) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: missionRow } = await supabase
      .from('missions')
      .select('mission_json')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();

    if (!missionRow) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    const missionJson = missionRow.mission_json as Record<string, unknown>;
    const existing = Array.isArray(missionJson.permissions)
      ? (missionJson.permissions as Array<{ service: string }>)
      : [];

    // Skip if provider already registered in this mission's permissions
    if (existing.some(p => p.service === provider)) {
      return NextResponse.json({ success: true, added: false });
    }

    const updated = [
      ...existing,
      { service: provider, type, scope, granted: true },
    ];

    const { error } = await supabase
      .from('missions')
      .update({
        mission_json: { ...missionJson, permissions: updated },
        updated_at: new Date().toISOString(),
      })
      .eq('id', missionId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[add-connector] DB update error:', error);
      return NextResponse.json({ error: 'Failed to update mission permissions' }, { status: 500 });
    }

    return NextResponse.json({ success: true, added: true });

  } catch (err) {
    console.error('[POST /api/missions/[id]/add-connector]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
