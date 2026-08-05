import { NextRequest, NextResponse } from 'next/server';

// These callbacks are no longer used.
// All OAuth flows now go through Composio → /api/composio/callback.
// Anyone landing here has a stale redirect URI — send them to Connectors page.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  console.warn(`[legacy-oauth-callback] ${provider} callback hit — stale redirect URI. Redirecting to Connectors.`);
  return NextResponse.redirect(new URL(`/connectors?reconnect=${provider}`, request.url));
}
