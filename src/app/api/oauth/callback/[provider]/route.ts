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
  // ── Social Media Connectors ──
  twitter: {
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    clientIdEnv: 'TWITTER_CLIENT_ID',
    clientSecretEnv: 'TWITTER_CLIENT_SECRET',
  },
  facebook: {
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    clientIdEnv: 'FACEBOOK_APP_ID',
    clientSecretEnv: 'FACEBOOK_APP_SECRET',
  },
  instagram: {
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    clientIdEnv: 'FACEBOOK_APP_ID',
    clientSecretEnv: 'FACEBOOK_APP_SECRET',
  },
  // ── New OAuth Providers ──
  atlassian: {
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    clientIdEnv: 'ATLASSIAN_CLIENT_ID',
    clientSecretEnv: 'ATLASSIAN_CLIENT_SECRET',
  },
  salesforce: {
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    clientIdEnv: 'SALESFORCE_CLIENT_ID',
    clientSecretEnv: 'SALESFORCE_CLIENT_SECRET',
  },
  hubspot: {
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    clientIdEnv: 'HUBSPOT_CLIENT_ID',
    clientSecretEnv: 'HUBSPOT_CLIENT_SECRET',
  },
  mailchimp: {
    tokenUrl: 'https://login.mailchimp.com/oauth2/token',
    clientIdEnv: 'MAILCHIMP_CLIENT_ID',
    clientSecretEnv: 'MAILCHIMP_CLIENT_SECRET',
  },
  intercom: {
    tokenUrl: 'https://api.intercom.io/auth/eagle/token',
    clientIdEnv: 'INTERCOM_CLIENT_ID',
    clientSecretEnv: 'INTERCOM_CLIENT_SECRET',
  },
  dropbox: {
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    clientIdEnv: 'DROPBOX_CLIENT_ID',
    clientSecretEnv: 'DROPBOX_CLIENT_SECRET',
  },
  box: {
    tokenUrl: 'https://api.box.com/oauth2/token',
    clientIdEnv: 'BOX_CLIENT_ID',
    clientSecretEnv: 'BOX_CLIENT_SECRET',
  },
  monday: {
    tokenUrl: 'https://auth.monday.com/oauth2/token',
    clientIdEnv: 'MONDAY_CLIENT_ID',
    clientSecretEnv: 'MONDAY_CLIENT_SECRET',
  },
  asana: {
    tokenUrl: 'https://app.asana.com/-/oauth_token',
    clientIdEnv: 'ASANA_CLIENT_ID',
    clientSecretEnv: 'ASANA_CLIENT_SECRET',
  },
  paypal: {
    tokenUrl: 'https://api-m.paypal.com/v1/oauth2/token',
    clientIdEnv: 'PAYPAL_CLIENT_ID',
    clientSecretEnv: 'PAYPAL_CLIENT_SECRET',
  },
  square: {
    tokenUrl: 'https://connect.squareup.com/oauth2/token',
    clientIdEnv: 'SQUARE_CLIENT_ID',
    clientSecretEnv: 'SQUARE_CLIENT_SECRET',
  },
  reddit: {
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    clientIdEnv: 'REDDIT_CLIENT_ID',
    clientSecretEnv: 'REDDIT_CLIENT_SECRET',
  },
  microsoft: {
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
  },
  airtable: {
    tokenUrl: 'https://airtable.com/oauth2/v1/token',
    clientIdEnv: 'AIRTABLE_CLIENT_ID',
    clientSecretEnv: 'AIRTABLE_CLIENT_SECRET',
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
    } else if (provider === 'twitter' || provider === 'airtable') {
      // PKCE providers — require code_verifier from cookie + Basic Auth
      const codeVerifier = request.cookies.get(`${provider}_code_verifier`)?.value || '';
      if (!codeVerifier) {
        console.error(`[OAuth ${provider}] Missing ${provider}_code_verifier cookie`);
      }
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      tokenRes = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
      });
    } else if (provider === 'monday') {
      // Monday.com requires JSON body
      tokenRes = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
    } else if (provider === 'paypal' || provider === 'reddit') {
      // PayPal and Reddit require Basic Auth header
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      tokenRes = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }).toString(),
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
    } else if (provider === 'twitter') {
      // Twitter OAuth 2.0 response
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token || '';
      expiresIn = tokenData.expires_in || 7200; // default 2 hours
      scope = tokenData.scope || '';
    } else if (provider === 'facebook' || provider === 'instagram') {
      // Facebook/Instagram Graph API token
      accessToken = tokenData.access_token;
      expiresIn = tokenData.expires_in || 5184000; // ~60 days for long-lived
      scope = '';
      // Exchange short-lived token for long-lived token
      try {
        const longLivedRes = await fetch(
          `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${accessToken}`
        );
        const longLivedData = await longLivedRes.json();
        if (longLivedData.access_token) {
          accessToken = longLivedData.access_token;
          expiresIn = longLivedData.expires_in || 5184000;
          console.log(`[OAuth ${provider}] Exchanged for long-lived token (${expiresIn}s)`);
        }
      } catch (ltErr) {
        console.warn(`[OAuth ${provider}] Long-lived token exchange failed (non-fatal):`, ltErr);
      }
    } else if (provider === 'atlassian') {
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token || '';
      expiresIn = tokenData.expires_in || 3600;
      scope = tokenData.scope || '';
      // Fetch the Atlassian cloudId (required for API calls to Jira/Confluence)
      try {
        const resourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
        });
        if (resourcesRes.ok) {
          const resources = await resourcesRes.json();
          if (resources[0]?.id) {
            // Store token + cloudId as JSON so agents can construct Atlassian API URLs
            accessToken = JSON.stringify({ token: tokenData.access_token, cloud_id: resources[0].id, site_url: resources[0].url });
          }
        }
      } catch (cloudErr) {
        console.warn('[OAuth atlassian] Could not fetch cloudId (non-fatal):', cloudErr);
      }
    } else if (provider === 'salesforce') {
      // Salesforce returns instance_url alongside access_token — store both in JSON
      const instanceUrl = tokenData.instance_url || '';
      accessToken = instanceUrl
        ? JSON.stringify({ token: tokenData.access_token, instance_url: instanceUrl })
        : tokenData.access_token;
      refreshToken = tokenData.refresh_token || '';
      scope = tokenData.scope || '';
    } else if (provider === 'hubspot' || provider === 'mailchimp' || provider === 'intercom' ||
               provider === 'dropbox' || provider === 'box' || provider === 'monday' ||
               provider === 'asana' || provider === 'paypal' || provider === 'square' ||
               provider === 'reddit' || provider === 'microsoft' || provider === 'airtable') {
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token || '';
      expiresIn = tokenData.expires_in || 3600;
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
    
    console.log(`[OAuth ${provider}] Attempting to store token. tenantId=${tenantId}, hasAccessToken=${!!accessToken}, tokenLength=${accessToken?.length || 0}`);
    
    if (tenantId) {
      // Store bot/primary token — with full error handling
      const upsertPayload = {
        tenant_id: tenantId,
        provider: provider,
        access_token: accessToken,
        refresh_token: refreshToken || null,
        expires_at: expiresIn > 0 
          ? new Date(Date.now() + expiresIn * 1000).toISOString() 
          : null,
        scopes: scope ? scope.split(/[,\s]+/).filter(Boolean) : [],
        updated_at: new Date().toISOString(),
      };

      // Try upsert first
      const { error: upsertError } = await supabase
        .from('tenant_permissions')
        .upsert(upsertPayload, {
          onConflict: 'tenant_id,provider',
        });

      if (upsertError) {
        console.error(`[OAuth ${provider}] Upsert FAILED: ${upsertError.message} (code: ${upsertError.code}, details: ${upsertError.details})`);
        
        // Fallback: try delete + insert if upsert fails (missing unique constraint)
        console.log(`[OAuth ${provider}] Attempting fallback: delete + insert...`);
        
        await supabase
          .from('tenant_permissions')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('provider', provider);
        
        const { error: insertError } = await supabase
          .from('tenant_permissions')
          .insert(upsertPayload);
        
        if (insertError) {
          console.error(`[OAuth ${provider}] INSERT also FAILED: ${insertError.message} (code: ${insertError.code}, details: ${insertError.details})`);
        } else {
          console.log(`[OAuth ${provider}] ✅ Fallback INSERT succeeded for tenant ${tenantId}`);
        }
      } else {
        console.log(`[OAuth ${provider}] ✅ Upsert succeeded for tenant ${tenantId}`);
      }

      // Verify the token was actually stored
      const { data: verifyRow, error: verifyError } = await supabase
        .from('tenant_permissions')
        .select('provider, access_token')
        .eq('tenant_id', tenantId)
        .eq('provider', provider)
        .single();
      
      if (verifyError || !verifyRow) {
        console.error(`[OAuth ${provider}] ❌ VERIFICATION FAILED — token NOT in DB! Error: ${verifyError?.message}`);
      } else {
        console.log(`[OAuth ${provider}] ✅ VERIFIED — token exists in DB. provider=${verifyRow.provider}, tokenLength=${verifyRow.access_token?.length || 0}`);
      }

      // For Slack: also store user token separately if present
      if (provider === 'slack' && tokenData.authed_user?.access_token) {
        const { error: slackUserError } = await supabase
          .from('tenant_permissions')
          .upsert({
            tenant_id: tenantId,
            provider: 'slack_user',
            access_token: tokenData.authed_user.access_token,
            refresh_token: null,
            expires_at: null,
            scopes: tokenData.authed_user.scope ? tokenData.authed_user.scope.split(/[,\s]+/).filter(Boolean) : [],
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'tenant_id,provider',
          });
        if (slackUserError) {
          console.error(`[OAuth slack_user] Upsert FAILED: ${slackUserError.message}`);
        } else {
          console.log(`[OAuth slack] Both bot AND user tokens stored for tenant ${tenantId}`);
        }
      }
    } else {
      console.error(`[OAuth ${provider}] ❌ No tenantId in state parameter! Cannot store token.`);
    }

    // ── Notify customer if any missions were waiting for this connector ──
    if (tenantId) {
      try {
        const { data: waitingMissions } = await supabase
          .from('missions')
          .select('id, mission_json, tenant_id')
          .eq('tenant_id', tenantId)
          .in('status', ['pending', 'failed', 'paused']);

        if (waitingMissions?.length) {
          for (const m of waitingMissions) {
            const agents = m.mission_json?.agents || [];
            const needsProvider = agents.some((a: any) => 
              a.connectors?.includes(provider) || 
              a.connectors?.includes(provider.replace('_oidc', ''))
            );
            if (needsProvider) {
              // Log a connector.ready event for this mission
              await supabase.from('events').insert({
                tenant_id: tenantId,
                event_type: 'connector.ready',
                entity_type: 'mission',
                entity_id: m.id,
                payload: { provider, missionTitle: m.mission_json?.title },
              });
              console.log(`[OAuth] Mission "${m.mission_json?.title}" can now use ${provider}`);
            }
          }
        }
      } catch (notifyErr) {
        console.warn('[OAuth] Mission notification check failed (non-fatal):', notifyErr);
      }
    }
    // ── Smart redirect: popup-aware ──
    // If opened as a popup from mission page, send postMessage and close.
    // If opened directly (e.g., from connectors page), redirect normally.
    // Clean display name for the provider
    const DISPLAY_NAMES: Record<string, string> = {
      linkedin_oidc: 'LinkedIn', github: 'GitHub', slack: 'Slack',
      google: 'Google', notion: 'Notion', zoho: 'Zoho', discord: 'Discord',
      twitter: 'Twitter / X', facebook: 'Facebook', instagram: 'Instagram',
      atlassian: 'Atlassian', salesforce: 'Salesforce', hubspot: 'HubSpot',
      mailchimp: 'Mailchimp', intercom: 'Intercom', dropbox: 'Dropbox',
      box: 'Box', monday: 'Monday.com', asana: 'Asana', paypal: 'PayPal',
      square: 'Square', reddit: 'Reddit', microsoft: 'Microsoft', airtable: 'Airtable',
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
