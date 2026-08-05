import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { toComposioApp, fromComposioApp } from '@/lib/services/composio';

const COMPOSIO_API_BASE = 'https://backend.composio.dev';

// POST /api/composio/disconnect
// Body: { provider: string }  — pass the Composio slug (e.g. "gmail", "trello")
//
// 1. Deletes ALL matching rows from tenant_permissions (slug form + legacy AF key form)
//    so that a reload never shows the app as connected again.
// 2. Also revokes the connected account in Composio so the expired token
//    doesn't linger on their side and the next connect gets a clean slate.
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const body = await request.json().catch(() => ({}));
  const provider: string = body.provider ?? '';
  if (!provider) return NextResponse.json({ error: 'provider is required' }, { status: 400 });

  const apiKey = process.env.COMPOSIO_API_KEY;
  const supabase = createServiceClient();

  // Build the full set of provider strings that might be stored for this app.
  // e.g. "gmail" → also check "google" (legacy AF key); "google" → also check "gmail"
  const composioSlug = toComposioApp(provider);    // e.g. 'google' → 'gmail', 'gmail' → 'gmail'
  const afLegacyKey  = fromComposioApp(composioSlug); // e.g. 'gmail' → 'google'
  const toDelete = Array.from(new Set([provider, composioSlug, afLegacyKey].filter(Boolean)));

  // Delete from Supabase — all forms so no stale record survives a reload
  for (const p of toDelete) {
    await supabase
      .from('tenant_permissions')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('provider', p);
  }

  // Also revoke in Composio (non-fatal if it fails — Supabase cleanup is the critical part)
  if (apiKey) {
    try {
      const listRes = await fetch(
        `${COMPOSIO_API_BASE}/api/v3.1/connectedAccounts?user_id=${encodeURIComponent(tenantId)}&toolkit_slug=${encodeURIComponent(composioSlug)}&limit=20`,
        { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(10_000) }
      );
      if (listRes.ok) {
        const listData = await listRes.json() as { items?: { id: string }[] };
        const accounts = listData.items ?? [];
        await Promise.allSettled(
          accounts.map(account =>
            fetch(`${COMPOSIO_API_BASE}/api/v3.1/connectedAccounts/${account.id}`, {
              method: 'DELETE',
              headers: { 'x-api-key': apiKey },
              signal: AbortSignal.timeout(10_000),
            })
          )
        );
        console.log(`[disconnect] Revoked ${accounts.length} Composio account(s) for ${composioSlug} / tenant ${tenantId}`);
      }
    } catch (err) {
      console.warn('[disconnect] Composio revoke failed (non-fatal):', err);
    }
  }

  // Also clean up any granted permissions for this provider
  await supabase
    .from('permissions')
    .update({ granted: false })
    .eq('tenant_id', tenantId)
    .in('service', toDelete);

  console.log(`[disconnect] Cleaned up ${toDelete.join(', ')} for tenant ${tenantId}`);
  return NextResponse.json({ success: true });
}
