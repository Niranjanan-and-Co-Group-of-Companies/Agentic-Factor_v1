import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { syncConnections } from '@/lib/services/app-connections';

// POST /api/composio/sync { provider? } — asks Composio which apps are connected and records any the
// platform missed. The app calls it when the sign-in browser closes, so a connection made there counts
// even if its last step (the callback) didn't arrive. Returns the apps now connected.
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { provider } = await request.json().catch(() => ({})) as { provider?: string };
  const supabase = createServiceClient();
  try {
    const added = await syncConnections(supabase, tenantId, { force: true });
    const { data } = await supabase.from('tenant_permissions').select('provider').eq('tenant_id', tenantId);
    const connected = (data ?? []).map((r: { provider: string }) => r.provider);
    return NextResponse.json({
      added,
      connected,
      ...(provider ? { providerConnected: connected.some(p => p.toLowerCase() === provider.toLowerCase()) } : {}),
    });
  } catch (err) {
    console.error('[composio/sync]', err);
    return NextResponse.json({ error: 'Could not check your connections' }, { status: 500 });
  }
}
