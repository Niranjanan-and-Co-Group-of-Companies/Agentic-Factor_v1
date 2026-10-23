// Which apps an account has connected. Composio holds the connections; tenant_permissions records them
// for the platform (what the assistant, missions and the app see). The record is written when the
// connect callback arrives — and, if that step was missed (the phone lost signal, or the callback went
// to another deployment), by a sync that asks Composio directly.

import type { SupabaseClient } from '@supabase/supabase-js';

const CONNECTED_ACCOUNTS = 'https://backend.composio.dev/api/v3.1/connected_accounts';

/** Records an app as connected and grants the missions that were waiting for it. */
export async function recordConnection(supabase: SupabaseClient, tenantId: string, provider: string): Promise<void> {
  // Composio manages the tokens: only the connection is recorded here.
  const { error } = await supabase.from('tenant_permissions').upsert({
    tenant_id: tenantId,
    provider,
    access_token: 'composio_managed',
    refresh_token: null,
    expires_at: null,
    scopes: [],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id, provider' });
  if (error) throw new Error(`Could not record ${provider}: ${error.message}`);
  await supabase.from('permissions').update({ granted: true }).eq('tenant_id', tenantId).eq('service', provider);
}

/** The account's active connections at Composio, as toolkit slugs — null when Composio can't be asked. */
export async function composioConnections(tenantId: string, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  const slugs = new Set<string>();
  let cursor: string | null = null;
  try {
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({ user_ids: tenantId, statuses: 'ACTIVE', limit: '100' });
      if (cursor) q.set('cursor', cursor);
      const res = await fetchImpl(`${CONNECTED_ACCOUNTS}?${q}`, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const body = await res.json() as { items?: Array<{ status?: string; toolkit?: { slug?: string } }>; next_cursor?: string | null };
      for (const item of body.items ?? []) {
        if (item.status === 'ACTIVE' && item.toolkit?.slug) slugs.add(item.toolkit.slug.toLowerCase());
      }
      cursor = body.next_cursor ?? null;
      if (!cursor) break;
    }
  } catch {
    return null;
  }
  return [...slugs];
}

const lastSync = new Map<string, number>();
const SYNC_EVERY_MS = 5 * 60_000;

/**
 * Records connections Composio has that the platform missed. Returns the apps it added. Without `force`
 * it asks Composio at most every 5 minutes per account (it runs on every chat message).
 */
export async function syncConnections(
  supabase: SupabaseClient,
  tenantId: string,
  opts: { force?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<string[]> {
  const now = Date.now();
  if (!opts.force && now - (lastSync.get(tenantId) ?? 0) < SYNC_EVERY_MS) return [];
  lastSync.set(tenantId, now);
  const active = await composioConnections(tenantId, opts.fetchImpl);
  if (!active || active.length === 0) return [];
  const { data } = await supabase.from('tenant_permissions').select('provider').eq('tenant_id', tenantId);
  const recorded = new Set((data ?? []).map((r: { provider: string }) => r.provider.toLowerCase()));
  const missing = active.filter(slug => !recorded.has(slug));
  for (const slug of missing) await recordConnection(supabase, tenantId, slug);
  if (missing.length) console.log(`[app-connections] Recorded ${missing.join(', ')} for ${tenantId} from Composio`);
  return missing;
}
