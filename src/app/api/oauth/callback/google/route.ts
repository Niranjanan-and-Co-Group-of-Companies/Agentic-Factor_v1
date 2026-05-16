import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) {
    return new NextResponse(`
      <html><body><script>
        window.opener.postMessage({ type: 'OAUTH_ERROR', payload: 'Unauthorized' }, '*');
        window.close();
      </script></body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  const { tenantId } = authResult;
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    return new NextResponse(`
      <html><body><script>
        window.opener.postMessage({ type: 'OAUTH_ERROR', payload: '${error || 'No code provided'}' }, '*');
        window.close();
      </script></body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/oauth/callback/google`;

  if (!clientId || !clientSecret) {
    return new NextResponse(`
      <html><body><script>
        window.opener.postMessage({ type: 'OAUTH_ERROR', payload: 'Missing OAuth configuration' }, '*');
        window.close();
      </script></body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      throw new Error(tokenData.error_description || 'Failed to get token');
    }

    const { access_token, refresh_token, expires_in, scope } = tokenData;

    const supabase = createServiceClient();

    // Upsert into tenant_permissions
    const { error: upsertError } = await supabase
      .from('tenant_permissions')
      .upsert({
        tenant_id: tenantId,
        provider: 'google',
        access_token,
        refresh_token: refresh_token || null, // Might not be returned if not first authorization
        expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
        scopes: scope ? scope.split(' ') : [],
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'tenant_id, provider'
      });

    if (upsertError) {
      throw new Error('Failed to save permissions: ' + upsertError.message);
    }

    // Success! Send message to opener window and close
    return new NextResponse(`
      <html><body><script>
        window.opener.postMessage({ type: 'OAUTH_SUCCESS', provider: 'google' }, '*');
        window.close();
      </script></body></html>
    `, { headers: { 'Content-Type': 'text/html' } });

  } catch (err) {
    console.error('[Google OAuth Callback Error]', err);
    return new NextResponse(`
      <html><body><script>
        window.opener.postMessage({ type: 'OAUTH_ERROR', payload: '${(err as Error).message}' }, '*');
        window.close();
      </script></body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }
}
