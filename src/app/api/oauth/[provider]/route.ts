import { NextRequest, NextResponse } from 'next/server';
import { appBaseUrl } from '@/lib/utils/app-url';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { initiateComposioConnection } from '@/lib/services/composio';
import { connectCallbackUrl } from '@/lib/services/connect-state';

// ============================================================
// Legacy OAuth initiation — upgraded to Composio
//
// This route used to run a direct OAuth flow per provider.
// All OAuth connections now go through Composio so that
// Composio manages token refresh, retries, and action schemas.
//
// Any stale link, cached URL, or code path that still hits
// /api/oauth/[provider] is silently redirected to the Composio
// OAuth flow and lands in /api/composio/callback instead.
// ============================================================

const LEGACY_TO_COMPOSIO: Record<string, string> = {
  google:        'gmail',
  microsoft:     'outlook',
  monday:        'mondaydotcom',
  linkedin_oidc: 'linkedin',
  linkedin:      'linkedin',
  atlassian:     'jira',
  // All others have matching slugs (slack→slack, github→github, etc.)
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { tenantId } = authResult;
  const composioSlug = LEGACY_TO_COMPOSIO[provider] ?? provider;
  const appUrl = appBaseUrl();
  const callbackUrl = connectCallbackUrl(appUrl, { tenantId, provider: composioSlug });

  try {
    const authUrl = await initiateComposioConnection(tenantId, composioSlug, callbackUrl);
    console.log(`[legacy-oauth] Upgraded ${provider} → Composio ${composioSlug} for tenant ${tenantId}`);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error(`[legacy-oauth] Composio redirect failed for ${provider}:`, err);
    return NextResponse.redirect(new URL('/connectors?error=connection_failed', request.url));
  }
}
