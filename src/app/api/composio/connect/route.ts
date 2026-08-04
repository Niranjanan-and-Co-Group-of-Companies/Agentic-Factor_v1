import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { initiateComposioConnection } from '@/lib/services/composio';

// ============================================================
// POST /api/composio/connect
// Body: { provider: string }
// Starts a Composio-managed OAuth flow for the given provider.
// Returns { authUrl } — frontend opens it in a popup.
// After auth, Composio redirects to /api/composio/callback.
// ============================================================

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { tenantId } = authResult;

  const { provider } = await request.json();
  if (!provider) {
    return NextResponse.json({ error: 'Missing provider' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/composio/callback?tenantId=${tenantId}&provider=${provider}`;

  try {
    const authUrl = await initiateComposioConnection(tenantId, provider, redirectUri);
    return NextResponse.json({ authUrl });
  } catch (err) {
    console.error('[Composio Connect]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
