import { createServiceClient } from '../supabase/server';

export interface TokenContext {
  provider: string;
  access_token: string;
}

/**
 * Validates and returns an active OAuth token for the tenant and provider.
 * If the token is expired but has a refresh_token, it silently refreshes it.
 * If the token is missing, fully expired, or revoked, it returns null.
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

  // Token is expired. Do we have a refresh token?
  if (!refresh_token) {
    console.warn(`[OAuth Refresher] Token for ${provider} expired and no refresh token available.`);
    return null;
  }

  console.log(`[OAuth Refresher] Token for ${provider} expired. Attempting refresh...`);

  try {
    let clientId = '';
    let clientSecret = '';

    if (provider === 'google') {
      clientId = process.env.GOOGLE_CLIENT_ID!;
      clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    } else {
      // Add other providers here (slack, etc.)
      console.error(`[OAuth Refresher] Unsupported provider for refresh: ${provider}`);
      return null;
    }

    if (!clientId || !clientSecret) {
      console.error(`[OAuth Refresher] Missing OAuth environment variables for ${provider}`);
      return null;
    }

    // Attempt to refresh
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    const refreshData = await refreshRes.json();

    if (!refreshRes.ok) {
      console.error(`[OAuth Refresher] Failed to refresh token: ${refreshData.error_description || refreshData.error}`);
      return null;
    }

    // Success! Update database
    const newAccessToken = refreshData.access_token;
    // Note: Google sometimes doesn't send a new refresh_token, keep the old one if so
    const newRefreshToken = refreshData.refresh_token || refresh_token; 
    const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();

    const { error: updateError } = await supabase
      .from('tenant_permissions')
      .update({
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString()
      })
      .eq('tenant_id', tenantId)
      .eq('provider', provider);

    if (updateError) {
      console.error(`[OAuth Refresher] Failed to save refreshed token to database: ${updateError.message}`);
      return null; // Don't return the token if we couldn't save it, to stay consistent
    }

    console.log(`[OAuth Refresher] Successfully refreshed token for ${provider}!`);
    return { provider, access_token: newAccessToken };

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
