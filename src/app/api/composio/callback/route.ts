import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/composio/callback
// Composio redirects here after the user grants OAuth access.
// Query params: tenantId, provider (encoded in the callback_url we pass to link.create)
//
// 1. Write minimal row to tenant_permissions so executor knows
//    this provider is connected (Composio manages tokens internally)
// 2. Auto-grant mission permissions for this service
// 3. Send OAUTH_SUCCESS postMessage to close the popup
// ============================================================

const successHtml = (provider: string) => `
<html><body><script>
  window.opener && window.opener.postMessage({ type: 'OAUTH_SUCCESS', provider: '${provider}' }, '*');
  window.close();
</script><p>Connected! You can close this window.</p></body></html>`;

const errorHtml = (msg: string) => `
<html><body><script>
  window.opener && window.opener.postMessage({ type: 'OAUTH_ERROR', payload: '${msg}' }, '*');
  window.close();
</script><p>Error: ${msg}</p></body></html>`;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const tenantId = searchParams.get('tenantId');
  const provider = searchParams.get('provider');
  const error = searchParams.get('error');

  if (error) {
    console.error('[Composio Callback] OAuth error:', error);
    return new NextResponse(errorHtml(error), { headers: { 'Content-Type': 'text/html' } });
  }

  if (!tenantId || !provider) {
    return new NextResponse(errorHtml('Missing tenantId or provider'), { headers: { 'Content-Type': 'text/html' } });
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

    return new NextResponse(successHtml(provider), { headers: { 'Content-Type': 'text/html' } });
  } catch (err) {
    console.error('[Composio Callback] Error:', err);
    return new NextResponse(errorHtml('Connection failed'), { headers: { 'Content-Type': 'text/html' } });
  }
}
