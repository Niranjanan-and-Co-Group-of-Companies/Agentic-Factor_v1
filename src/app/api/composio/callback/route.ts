import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { withOutcome } from '@/lib/utils/app-return';
import { readConnectState } from '@/lib/services/connect-state';

// ============================================================
// GET /api/composio/callback
// Composio redirects here after the user grants OAuth access.
// Query params: state — our signed ticket naming the account, the app and where to return
// (see services/connect-state.ts); error, when the customer did not grant access.
//
// 1. Write minimal row to tenant_permissions so executor knows
//    this provider is connected (Composio manages tokens internally)
// 2. Auto-grant mission permissions for this service
// 3. Send OAUTH_SUCCESS postMessage to close the popup
// ============================================================

// Values go into the page as JSON (in the script) and escaped text (in the page): the error comes from
// the address, and pasting it in raw let a crafted link run its own script on our site.
const inScript = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c');
const asText = (v: string) => v.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

const successHtml = (provider: string) => `
<html><body><script>
  window.opener && window.opener.postMessage({ type: 'OAUTH_SUCCESS', provider: ${inScript(provider)} }, '*');
  window.close();
</script><p>Connected! You can close this window.</p></body></html>`;

const errorHtml = (msg: string) => `
<html><body><script>
  window.opener && window.opener.postMessage({ type: 'OAUTH_ERROR', payload: ${inScript(msg)} }, '*');
  window.close();
</script><p>Error: ${asText(msg)}</p></body></html>`;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  // Who is connecting what comes only from our own signed ticket, never from loose parameters.
  const state = readConnectState(searchParams.get('state'));
  const tenantId = state?.tenantId;
  const provider = state?.provider;
  const error = searchParams.get('error');
  // From the mobile app: send the customer back into it instead of closing a popup.
  const returnTo = state?.returnTo ?? null;
  const fail = (msg: string) => returnTo
    ? NextResponse.redirect(withOutcome(returnTo, { status: 'error', provider: provider ?? '', message: msg }))
    : new NextResponse(errorHtml(msg), { headers: { 'Content-Type': 'text/html' } });

  if (error) {
    console.error('[Composio Callback] OAuth error:', error);
    return fail(error);
  }

  if (!tenantId || !provider) {
    return fail('This connection link has expired or is not valid. Please connect the app again.');
  }

  try {
    const supabase = createServiceClient();

    // Write to tenant_permissions so executor knows this provider is connected.
    // Composio manages tokens internally — we just record the connection.
    await supabase.from('tenant_permissions').upsert({
      tenant_id: tenantId,
      provider,
      access_token: 'composio_managed',
      refresh_token: null,
      expires_at: null,
      scopes: [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id, provider' });

    // Auto-grant mission permissions for this service
    await supabase
      .from('permissions')
      .update({ granted: true })
      .eq('tenant_id', tenantId)
      .eq('service', provider);

    console.log(`[Composio Callback] Connected ${provider} for tenant ${tenantId}`);

    // Refresh tool schemas for all missions that require this provider (fire-and-forget)
    refreshToolsForMissions(supabase, tenantId, provider).catch(err =>
      console.error('[Composio Callback] Tool refresh error:', err)
    );

    if (returnTo) return NextResponse.redirect(withOutcome(returnTo, { status: 'connected', provider }));
    return new NextResponse(successHtml(provider), { headers: { 'Content-Type': 'text/html' } });
  } catch (err) {
    console.error('[Composio Callback] Error:', err);
    return fail('Connection failed');
  }
}

async function refreshToolsForMissions(
  supabase: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>,
  tenantId: string,
  newProvider: string
): Promise<void> {
  // Get all tenant's missions
  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(20);

  if (!missions || missions.length === 0) return;

  // Get all connected providers for this tenant
  const { data: perms } = await supabase
    .from('tenant_permissions')
    .select('provider')
    .eq('tenant_id', tenantId);

  const connectedProviders = (perms ?? []).map(p => p.provider);
  if (connectedProviders.length === 0) return;

  const { refreshMissionTools } = await import('@/lib/services/tool-registry');

  // Refresh tools for each mission in the background
  await Promise.allSettled(
    missions.map(m => refreshMissionTools(tenantId, m.id as string, connectedProviders))
  );

  console.log(`[Composio Callback] Refreshed tools for ${missions.length} missions after connecting ${newProvider}`);
}
