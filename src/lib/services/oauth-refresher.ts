import { createServiceClient } from '../supabase/server';

export interface TokenContext {
  provider: string;
  access_token: string;
}

interface RefreshedToken {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

// Providers that issue a refresh_token and support the standard OAuth 2.0
// "grant_type=refresh_token" flow. Twitter requires HTTP Basic Auth instead
// of client_id/client_secret in the body — everything else uses body params.
interface StandardRefreshConfig {
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  useBasicAuth?: boolean;
}

const STANDARD_REFRESH_CONFIGS: Record<string, StandardRefreshConfig> = {
  google: { tokenUrl: 'https://oauth2.googleapis.com/token', clientIdEnv: 'GOOGLE_CLIENT_ID', clientSecretEnv: 'GOOGLE_CLIENT_SECRET' },
  slack: { tokenUrl: 'https://slack.com/api/oauth.v2.access', clientIdEnv: 'SLACK_CLIENT_ID', clientSecretEnv: 'SLACK_CLIENT_SECRET' },
  linkedin_oidc: { tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken', clientIdEnv: 'LINKEDIN_CLIENT_ID', clientSecretEnv: 'LINKEDIN_CLIENT_SECRET' },
  twitter: { tokenUrl: 'https://api.twitter.com/2/oauth2/token', clientIdEnv: 'TWITTER_CLIENT_ID', clientSecretEnv: 'TWITTER_CLIENT_SECRET', useBasicAuth: true },
  discord: { tokenUrl: 'https://discord.com/api/oauth2/token', clientIdEnv: 'DISCORD_CLIENT_ID', clientSecretEnv: 'DISCORD_CLIENT_SECRET' },
  zoho: { tokenUrl: 'https://accounts.zoho.com/oauth/v2/token', clientIdEnv: 'ZOHO_CLIENT_ID', clientSecretEnv: 'ZOHO_CLIENT_SECRET' },
};

async function refreshStandardOAuthToken(provider: string, refreshToken: string): Promise<RefreshedToken | null> {
  const config = STANDARD_REFRESH_CONFIGS[provider];
  if (!config) return null;

  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];
  if (!clientId || !clientSecret) {
    console.error(`[OAuth Refresher] Missing ${config.clientIdEnv}/${config.clientSecretEnv} for ${provider}`);
    return null;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const body: Record<string, string> = { grant_type: 'refresh_token', refresh_token: refreshToken };

  if (config.useBasicAuth) {
    headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    body.client_id = clientId;
    body.client_secret = clientSecret;
  }

  const res = await fetch(config.tokenUrl, { method: 'POST', headers, body: new URLSearchParams(body) });
  const data = await res.json();

  // Slack returns HTTP 200 with `ok: false` on logical failure instead of an HTTP error status
  if (!res.ok || data.ok === false || !data.access_token) {
    console.error(`[OAuth Refresher] Failed to refresh ${provider} token: ${data.error_description || data.error || JSON.stringify(data)}`);
    return null;
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token, // some providers omit this on refresh — caller keeps the old one
    expires_in: data.expires_in ?? 3600,
  };
}

// Facebook/Instagram (Graph API) don't use refresh_token at all — a still-valid
// long-lived access token is re-exchanged for a new long-lived one via a
// dedicated endpoint. Must be called before the current token actually expires.
async function refreshFacebookLongLivedToken(currentAccessToken: string): Promise<RefreshedToken | null> {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) {
    console.error(`[OAuth Refresher] Missing FACEBOOK_APP_ID/FACEBOOK_APP_SECRET`);
    return null;
  }

  const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('fb_exchange_token', currentAccessToken);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (!res.ok || !data.access_token) {
    console.error(`[OAuth Refresher] Failed to re-exchange Facebook/Instagram token: ${JSON.stringify(data.error || data)}`);
    return null;
  }

  return { access_token: data.access_token, expires_in: data.expires_in ?? 5_184_000 }; // ~60 days default
}

/**
 * Validates and returns an active OAuth token for the tenant and provider.
 * If the token is expired but can be refreshed, it silently refreshes it.
 * If the token is missing, fully expired with no way to refresh, or revoked,
 * it returns null.
 */
export async function getValidTokens(tenantId: string, provider: string): Promise<TokenContext | null> {
  const supabase = createServiceClient();

  const { data: row } = await supabase
    .from('tenant_permissions')
    .select('access_token, refresh_token, expires_at')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .single();

  if (!row) {
    return null;
  }

  const { access_token, refresh_token, expires_at } = row;

  // If there's no expiration or it's still good for at least 5 minutes, return it
  if (!expires_at || new Date(expires_at).getTime() > Date.now() + 5 * 60 * 1000) {
    return { provider, access_token };
  }

  console.log(`[OAuth Refresher] Token for ${provider} expired. Attempting refresh...`);

  try {
    let refreshed: RefreshedToken | null = null;

    if (provider === 'facebook' || provider === 'instagram') {
      // Re-exchange needs the current access token, not a refresh_token, and
      // only works if it hasn't fully expired yet (the 5-minute headroom above
      // gives this a real chance to succeed before that happens).
      refreshed = await refreshFacebookLongLivedToken(access_token);
    } else if (STANDARD_REFRESH_CONFIGS[provider]) {
      if (!refresh_token) {
        console.warn(`[OAuth Refresher] Token for ${provider} expired and no refresh token available.`);
        return null;
      }
      refreshed = await refreshStandardOAuthToken(provider, refresh_token);
    } else {
      console.error(`[OAuth Refresher] Unsupported provider for refresh: ${provider}`);
      return null;
    }

    if (!refreshed) {
      return null;
    }

    const newRefreshToken = refreshed.refresh_token || refresh_token;
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

    const { error: updateError } = await supabase
      .from('tenant_permissions')
      .update({
        access_token: refreshed.access_token,
        refresh_token: newRefreshToken,
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('provider', provider);

    if (updateError) {
      console.error(`[OAuth Refresher] Failed to save refreshed token to database: ${updateError.message}`);
      return null; // Don't return the token if we couldn't save it, to stay consistent
    }

    console.log(`[OAuth Refresher] Successfully refreshed token for ${provider}!`);
    return { provider, access_token: refreshed.access_token };

  } catch (err) {
    console.error(`[OAuth Refresher] Exception during token refresh:`, err);
    return null;
  }
}

/**
 * Parses a mission's required permissions and checks if the tenant has valid tokens for all of them.
 * Attempts to silently refresh any expired tokens.
 * Returns an array of providers that are completely missing or hopelessly expired.
 * If the array is empty, all required permissions are valid.
 */
export async function verifyMissionPermissions(missionId: string, tenantId: string): Promise<string[]> {
  const supabase = createServiceClient();

  console.log(`[VerifyPermissions] Checking mission=${missionId}, tenant=${tenantId}`);

  // 1. Fetch the mission
  const { data: missionData, error: missionError } = await supabase
    .from('missions')
    .select('mission_json')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  if (missionError || !missionData) {
    throw new Error('Mission not found or unauthorized');
  }

  const mission = missionData.mission_json;
  const requiredPermissions = mission.permissions || [];

  console.log(`[VerifyPermissions] Required permissions:`, JSON.stringify(requiredPermissions));

  if (requiredPermissions.length === 0) {
    console.log(`[VerifyPermissions] No permissions required — all clear`);
    return []; // No permissions required
  }

  // 2. Identify required providers
  // Map from common names (used in mission JSON) to DB provider keys (used in tenant_permissions)
  const PROVIDER_ALIASES: Record<string, string> = {
    'google': 'google', 'gmail': 'google', 'google mail': 'google',
    'google workspace': 'google', 'google calendar': 'google', 'google drive': 'google',
    'google sheets': 'google', 'google docs': 'google',
    'linkedin': 'linkedin_oidc', 'linkedin_oidc': 'linkedin_oidc',
    'slack': 'slack', 'slack_oidc': 'slack',
    'github': 'github', 'git': 'github',
    'notion': 'notion',
    'zoho': 'zoho', 'zoho crm': 'zoho',
    'discord': 'discord',
    // ── Social Media Connectors ──
    'twitter': 'twitter', 'x': 'twitter', 'x.com': 'twitter',
    'twitter/x': 'twitter', 'x (twitter)': 'twitter',
    'oauth 2.0 pkce': 'twitter',  // LLM often generates "Twitter/X OAuth 2.0 PKCE"
    'facebook': 'facebook', 'fb': 'facebook', 'meta': 'facebook',
    'facebook graph': 'facebook', 'graph api': 'facebook',
    'instagram': 'instagram', 'insta': 'instagram', 'ig': 'instagram',
    'whatsapp': 'whatsapp', 'messenger': 'messenger',
  };

  // Map api_key service names → DB provider keys in tenant_permissions
  const API_KEY_ALIASES: Record<string, string> = {
    'hunter': 'hunter', 'hunter.io': 'hunter', 'hunterio': 'hunter',
    'sendgrid': 'sendgrid', 'send grid': 'sendgrid',
    'stripe': 'stripe',
    'twilio': 'twilio',
    'openai': 'openai_api', 'open ai': 'openai_api',
    'anthropic': 'anthropic_api', 'claude': 'anthropic_api',
    'replicate': 'replicate',
    'segment': 'segment',
    'mixpanel': 'mixpanel',
    'aws': 'aws', 'amazon web services': 'aws',
    'firebase': 'firebase',
    'heygen': 'heygen',
    'razorpay': 'razorpay',
    'shiprocket': 'shiprocket',
  };

  const requiredProviders = new Set<string>();
  requiredPermissions.forEach((p: any) => {
    if (p.type === 'oauth_token') {
      const serviceLower = p.service.toLowerCase();
      for (const [alias, dbKey] of Object.entries(PROVIDER_ALIASES)) {
        if (serviceLower.includes(alias)) {
          console.log(`[VerifyPermissions] Mapped service "${p.service}" → DB key "${dbKey}" (via alias "${alias}")`);
          requiredProviders.add(dbKey);
          return;
        }
      }
      console.log(`[VerifyPermissions] No alias for "${p.service}" — using as-is: "${serviceLower}"`);
      requiredProviders.add(serviceLower);
    } else if (p.type === 'api_key') {
      const serviceLower = p.service.toLowerCase();
      for (const [alias, dbKey] of Object.entries(API_KEY_ALIASES)) {
        if (serviceLower.includes(alias)) {
          console.log(`[VerifyPermissions] API key: mapped service "${p.service}" → DB key "${dbKey}"`);
          requiredProviders.add(dbKey);
          return;
        }
      }
      // Fallback: use lower-cased service name
      console.log(`[VerifyPermissions] API key: no alias for "${p.service}" — using as-is: "${serviceLower}"`);
      requiredProviders.add(serviceLower);
    }
  });

  console.log(`[VerifyPermissions] Resolved providers to check: [${[...requiredProviders].join(', ')}]`);

  // Also log what's actually in tenant_permissions for this tenant
  const { data: allPerms, error: permsError } = await supabase
    .from('tenant_permissions')
    .select('provider, access_token, expires_at')
    .eq('tenant_id', tenantId);

  if (permsError) {
    console.error(`[VerifyPermissions] ❌ Failed to query tenant_permissions: ${permsError.message}`);
  } else {
    console.log(`[VerifyPermissions] Tenant has ${allPerms?.length || 0} stored permissions: [${allPerms?.map(p => `${p.provider}(token:${p.access_token ? p.access_token.substring(0, 10) + '...' : 'NULL'})`).join(', ')}]`);
  }

  // 3. Verify each provider
  const missingProviders: string[] = [];

  for (const provider of requiredProviders) {
    const token = await getValidTokens(tenantId, provider);
    if (!token) {
      console.log(`[VerifyPermissions] ❌ Provider "${provider}" — NO valid token found`);
      missingProviders.push(provider);
    } else {
      console.log(`[VerifyPermissions] ✅ Provider "${provider}" — valid token found (${token.access_token.substring(0, 10)}...)`);
    }
  }

  console.log(`[VerifyPermissions] Result: ${missingProviders.length === 0 ? '✅ ALL CLEAR' : `❌ Missing: [${missingProviders.join(', ')}]`}`);
  return missingProviders;
}
