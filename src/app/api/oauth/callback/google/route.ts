import { NextRequest, NextResponse } from 'next/server';

// This callback is no longer used.
// Google OAuth now flows through Composio → /api/composio/callback.
// Anyone landing here has a stale redirect URI — send them to Connectors page.
export async function GET(request: NextRequest) {
  console.warn('[legacy-oauth-callback] Google callback hit — stale redirect URI. Redirecting to Connectors.');
  return NextResponse.redirect(new URL('/connectors?reconnect=gmail', request.url));
}
