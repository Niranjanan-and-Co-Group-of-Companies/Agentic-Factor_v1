import { Composio } from 'composio-core';

// ============================================================
// Composio Service — OAuth Connection Management
// Composio stores and auto-refreshes tokens for all providers.
// AgenticFactor injects fresh tokens into E2B sandboxes at
// mission runtime via getComposioToken().
// ============================================================

let _client: InstanceType<typeof Composio> | null = null;

function getClient(): InstanceType<typeof Composio> {
  if (!_client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) throw new Error('COMPOSIO_API_KEY is not configured');
    _client = new Composio({ apiKey });
  }
  return _client;
}

// Map our internal provider keys → Composio app unique keys.
// These are Composio's canonical names from their app catalog.
export const PROVIDER_TO_COMPOSIO: Record<string, string> = {
  google:        'gmail',
  github:        'github',
  slack:         'slack',
  notion:        'notion',
  discord:       'discord',
  linkedin_oidc: 'linkedin',
  twitter:       'twitter',
  facebook:      'facebook',
  instagram:     'instagram',
  hubspot:       'hubspot',
  salesforce:    'salesforce',
  airtable:      'airtable',
  asana:         'asana',
  zoho:          'zoho',
  atlassian:     'jira',
  microsoft:     'outlook',
  dropbox:       'dropbox',
  monday:        'mondaydotcom',
  linear:        'linear',
  intercom:      'intercom',
  paypal:        'paypal',
  mailchimp:     'mailchimp',
  reddit:        'reddit',
};

// Reverse map: Composio app name → our provider key
const COMPOSIO_TO_PROVIDER: Record<string, string> = Object.fromEntries(
  Object.entries(PROVIDER_TO_COMPOSIO).map(([k, v]) => [v, k])
);

export function toComposioApp(provider: string): string {
  return PROVIDER_TO_COMPOSIO[provider] || provider;
}

export function fromComposioApp(appName: string): string {
  return COMPOSIO_TO_PROVIDER[appName] || appName;
}

/**
 * Initiate a Composio OAuth connection for a tenant.
 * Returns the URL to redirect the user to (Composio-managed OAuth flow).
 * After OAuth, Composio redirects to redirectUri.
 */
export async function initiateComposioConnection(
  tenantId: string,
  provider: string,
  redirectUri: string
): Promise<string> {
  const client = getClient();
  const entity = client.getEntity(tenantId);
  const appName = toComposioApp(provider);

  const req = await entity.initiateConnection({ appName, redirectUri });
  const authUrl = (req as any).redirectUrl;
  if (!authUrl) throw new Error(`Composio did not return a redirect URL for ${provider}`);
  return authUrl;
}

/**
 * Get a fresh access token for a tenant + provider pair from Composio.
 * Composio auto-refreshes expired tokens, so this always returns a valid token.
 * Returns null if no connection exists or if the provider is not supported.
 */
export async function getComposioToken(
  tenantId: string,
  provider: string
): Promise<string | null> {
  try {
    const client = getClient();
    const entity = client.getEntity(tenantId);
    const appName = toComposioApp(provider);

    const connection = await entity.getConnection({ appName });
    if (!connection) return null;

    const params = (connection as any).connectionParams;
    if (!params) return null;

    // OAuth2: token is in the Authorization header
    const authHeader = params.headers?.Authorization || params.headers?.authorization;
    if (authHeader) {
      return authHeader.replace(/^Bearer\s+/i, '').trim();
    }

    // Some providers store it directly
    const directToken = params.access_token || params.token;
    if (directToken) return directToken;

    return null;
  } catch {
    return null;
  }
}

/**
 * Get all providers a tenant has connected via Composio.
 * Used to merge with tenant_permissions for full connection status.
 */
export async function getComposioConnectedProviders(tenantId: string): Promise<string[]> {
  try {
    const client = getClient();
    const entity = client.getEntity(tenantId);
    const connections = await entity.getConnections();
    if (!connections || !Array.isArray(connections)) return [];

    return connections
      .filter((c: any) => c.status === 'ACTIVE')
      .map((c: any) => fromComposioApp(c.appName || c.appUniqueKey || ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}
