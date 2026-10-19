import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { initiateComposioConnection } from '@/lib/services/composio';
import { appReturnUrl } from '@/lib/utils/app-return';
import { connectCallbackUrl } from '@/lib/services/connect-state';

// ============================================================
// POST /api/composio/connect
// Body: { provider: string, returnTo?: string }
// Starts a Composio-managed OAuth flow for the given provider.
// Returns { authUrl } — the website opens it in a popup; the mobile app in its sign-in browser,
// passing returnTo (its own agenticfactor:// address) so the callback can send the customer back.
// After auth, Composio redirects to /api/composio/callback.
// ============================================================

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { tenantId } = authResult;

  const { provider, returnTo } = await request.json() as { provider?: string; returnTo?: unknown };
  if (!provider) {
    return NextResponse.json({ error: 'Missing provider' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const redirectUri = connectCallbackUrl(appUrl, { tenantId, provider, returnTo: appReturnUrl(returnTo) ?? undefined });

  try {
    const authUrl = await initiateComposioConnection(tenantId, provider, redirectUri);
    return NextResponse.json({ authUrl });
  } catch (err) {
    console.error('[Composio Connect]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
