import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// Dynamic OAuth Callback Handler — supports any provider
// URL: /api/oauth/callback/[provider]
// 
// Handles: GitHub, Slack, Zoho (and any future providers)
// Exchanges authorization code for access/refresh tokens,
// stores them in tenant_permissions for agent use.
// ============================================================

interface ProviderConfig {
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  scopeSeparator?: string;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  github: {
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET',
  },
  slack: {
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
  },
  zoho: {
    tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
    clientIdEnv: 'ZOHO_CLIENT_ID',
    clientSecretEnv: 'ZOHO_CLIENT_SECRET',
  },
  linkedin_oidc: {
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
  },
  notion: {
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    clientIdEnv: 'NOTION_CLIENT_ID',
    clientSecretEnv: 'NOTION_CLIENT_SECRET',
  },
  discord: {
    tokenUrl: 'https://discord.com/api/oauth2/token',
    clientIdEnv: 'DISCORD_CLIENT_ID',
    clientSecretEnv: 'DISCORD_CLIENT_SECRET',
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const config = PROVIDERS[provider];

  if (!config) {
    return NextResponse.redirect(new URL('/connectors?error=unknown_provider', request.url));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    console.error(`[OAuth ${provider}] Error:`, error || 'No code received');
    return NextResponse.redirect(new URL(`/connectors?error=${error || 'no_code'}`, request.url));
  }

  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];

  if (!clientId || !clientSecret) {
    console.error(`[OAuth ${provider}] Missing env vars: ${config.clientIdEnv} or ${config.clientSecretEnv}`);
    return NextResponse.redirect(new URL('/connectors?error=config_missing', request.url));
  }

  try {
    // Exchange code for tokens
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/oauth/callback/${provider}`;
    
    let tokenRes: Response;
    
    if (provider === 'github') {
      // GitHub uses JSON accept header
      tokenRes = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
    } else {
      let body: URLSearchParams | string = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });

      let headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };

      if (provider === 'notion') {
        // Notion requires Basic Auth header for token exchange
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        };
        body = JSON.stringify({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        });
      }

      tokenRes = await fetch(config.tokenUrl, {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : body.toString(),
      });
    }

    const tokenData = await tokenRes.json();

    // Handle different response formats
    let accessToken: string = '';
    let refreshToken: string = '';
    let expiresIn: number = 0;
    let scope: string = '';

    if (provider === 'github') {
      accessToken = tokenData.access_token;
      scope = tokenData.scope || '';
      // GitHub tokens don't expire (unless using GitHub App)
    } else if (provider === 'slack') {
      // Slack OAuth v2 returns BOTH bot and user tokens in one response
      accessToken = tokenData.access_token; // Bot token (xoxb-...)
      scope = tokenData.scope || '';
      // Slack bot tokens don't expire
    } else if (provider === 'zoho') {
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token || '';
      expiresIn = tokenData.expires_in || 3600;
      scope = tokenData.scope || '';
    } else if (provider === 'linkedin_oidc') {
      accessToken = tokenData.access_token;
      expiresIn = tokenData.expires_in || 5184000; // default 60 days
      scope = tokenData.scope || '';
    } else if (provider === 'notion') {
      accessToken = tokenData.access_token; // Notion tokens do not expire
      scope = tokenData.workspace_name || ''; // Notion doesn't return scope in response usually, but workspace_name is useful
    } else if (provider === 'discord') {
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token || '';
      expiresIn = tokenData.expires_in || 604800; // default 7 days
      scope = tokenData.scope || '';
    }

    if (!accessToken) {
      console.error(`[OAuth ${provider}] No access_token in response:`, tokenData);
      return NextResponse.redirect(new URL(`/connectors?error=no_token`, request.url));
    }

    // Get current user from Supabase session
    const supabase = createServiceClient();
    
    // The tenant_id is passed as the OAuth state parameter
    const tenantId = searchParams.get('state');
    
    if (tenantId) {
      // Store bot/primary token
      await supabase
        .from('tenant_permissions')
        .upsert({
          tenant_id: tenantId,
          provider: provider,
          access_token: accessToken,
          refresh_token: refreshToken || null,
          expires_at: expiresIn > 0 
            ? new Date(Date.now() + expiresIn * 1000).toISOString() 
            : null,
          scopes: scope,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'tenant_id,provider',
        });

      // For Slack: also store user token separately if present
      // This enables "acting as user" and "reading user DMs" capabilities
      if (provider === 'slack' && tokenData.authed_user?.access_token) {
        await supabase
          .from('tenant_permissions')
          .upsert({
            tenant_id: tenantId,
            provider: 'slack_user',
            access_token: tokenData.authed_user.access_token,
            refresh_token: null,
            expires_at: null,
            scopes: tokenData.authed_user.scope || '',
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'tenant_id,provider',
          });
        console.log(`[OAuth slack] Both bot AND user tokens stored for tenant ${tenantId}`);
      } else {
        console.log(`[OAuth ${provider}] Token stored for tenant ${tenantId}`);
      }
    }

    // ── Smart redirect: popup-aware ──
    // If opened as a popup from mission page, send postMessage and close.
    // If opened directly (e.g., from connectors page), redirect normally.
    // Clean display name for the provider
    const DISPLAY_NAMES: Record<string, string> = {
      linkedin_oidc: 'LinkedIn', github: 'GitHub', slack: 'Slack',
      google: 'Google', notion: 'Notion', zoho: 'Zoho', discord: 'Discord',
    };
    const displayName = DISPLAY_NAMES[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);

    const successHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Connected!</title>
<style>
  body { background: #0a0e1a; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; padding: 2rem; }
  .check { font-size: 3rem; margin-bottom: 1rem; }
  p { color: #8b95a5; font-size: 0.9rem; margin-top: 0.5rem; }
</style>
</head>
<body>
<div class="card">
  <div class="check">✅</div>
  <h2>${displayName} Connected!</h2>
  <p>This window will close automatically...</p>
</div>
<script>
  // Send success message to parent window (mission page popup flow)
  if (window.opener) {
    window.opener.postMessage({ type: 'OAUTH_SUCCESS', provider: '${provider}' }, '*');
    setTimeout(() => window.close(), 1200);
  } else {
    // Not a popup — redirect to connectors page
    setTimeout(() => { window.location.href = '/connectors?connected=${provider}'; }, 1500);
  }
</script>
</body>
</html>`;

    return new NextResponse(successHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });

  } catch (err) {
    console.error(`[OAuth ${provider}] Token exchange failed:`, err);
    
    // Error handling — also popup-aware
    const errorHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Connection Failed</title>
<style>
  body { background: #0a0e1a; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; padding: 2rem; }
  .icon { font-size: 3rem; margin-bottom: 1rem; }
  p { color: #8b95a5; font-size: 0.9rem; margin-top: 0.5rem; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">❌</div>
  <h2>Connection Failed</h2>
  <p>Something went wrong. Please try again.</p>
</div>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'OAUTH_ERROR', error: 'exchange_failed' }, '*');
    setTimeout(() => window.close(), 2000);
  } else {
    setTimeout(() => { window.location.href = '/connectors?error=exchange_failed'; }, 2000);
  }
</script>
</body>
</html>`;

    return new NextResponse(errorHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  }
}
