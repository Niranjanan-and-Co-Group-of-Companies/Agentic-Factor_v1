import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { refreshMissionTools } from '@/lib/services/tool-registry';

export const maxDuration = 60;

// POST /api/missions/[id]/refresh-tools
// Fetches (or re-fetches) Composio action schemas for all providers connected
// to this mission and stores them in mission_tool_schemas.
// Called: (a) proactively after a connector is connected, (b) on-demand from chat.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const supabase = createServiceClient();

  // Get all providers the tenant has connected
  const { data: perms } = await supabase
    .from('tenant_permissions')
    .select('provider')
    .eq('tenant_id', tenantId);

  const connectedProviders = (perms ?? []).map(p => p.provider);

  if (connectedProviders.length === 0) {
    return NextResponse.json({ success: true, message: 'No connected providers', count: 0 });
  }

  await refreshMissionTools(tenantId, missionId, connectedProviders);

  // Count how many schemas are now stored
  const { count } = await supabase
    .from('mission_tool_schemas')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('mission_id', missionId)
    .eq('is_active', true);

  return NextResponse.json({ success: true, count: count ?? 0, providers: connectedProviders });
}
