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
  
  if (requiredPermissions.length === 0) {
    return []; // No permissions required
  }

  // 2. Identify required providers
  const requiredProviders = new Set<string>();
  requiredPermissions.forEach((p: any) => {
    if (p.type === 'oauth_token') {
      if (p.service.toLowerCase().includes('google') || p.service.toLowerCase().includes('gmail')) {
        requiredProviders.add('google');
      } else if (p.service.toLowerCase().includes('slack')) {
        requiredProviders.add('slack_oidc');
      } else {
        requiredProviders.add(p.service.toLowerCase());
      }
    }
  });

  // 3. Verify each provider
  const missingProviders: string[] = [];
  
  for (const provider of requiredProviders) {
    const token = await getValidTokens(tenantId, provider);
    if (!token) {
      missingProviders.push(provider);
    }
  }

  return missingProviders;
}
