import Composio from '@composio/client';

// ============================================================
// Composio Service — OAuth Connection Management (v3.1 SDK)
// ============================================================

let _client: Composio | null = null;

function getClient(): Composio {
  if (!_client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) throw new Error('COMPOSIO_API_KEY is not configured');
    _client = new Composio({ apiKey });
  }
  return _client;
}

// Map our internal provider keys → Composio toolkit slugs.
export const PROVIDER_TO_COMPOSIO: Record<string, string> = {
  google:           'gmail',
  github:           'github',
  slack:            'slack',
  notion:           'notion',
  discord:          'discord',
  linkedin_oidc:    'linkedin',
  twitter:          'twitter',
  facebook:         'facebook',
  instagram:        'instagram',
  hubspot:          'hubspot',
  salesforce:       'salesforce',
  airtable:         'airtable',
  asana:            'asana',
  zoho:             'zoho',
  atlassian:        'jira',
  microsoft:        'outlook',
  dropbox:          'dropbox',
  monday:           'mondaydotcom',
  linear:           'linear',
  intercom:         'intercom',
  paypal:           'paypal',
  mailchimp:        'mailchimp',
  reddit:           'reddit',
  shopify:          'shopify',
  stripe:           'stripe',
  zendesk:          'zendesk',
  box:              'box',
  square:           'squareapp',
  // Paid advertising + analytics
  google_ads:       'googleads',
  google_analytics: 'googleanalytics',
  facebook_ads:     'facebookads',
  // Content, video & social scheduling
  youtube:          'youtube',
  buffer:           'buffer',
  canva:            'canva',
};

const COMPOSIO_TO_PROVIDER: Record<string, string> = Object.fromEntries(
  Object.entries(PROVIDER_TO_COMPOSIO).map(([k, v]) => [v, k])
);

export function toComposioApp(provider: string): string {
  return PROVIDER_TO_COMPOSIO[provider] || provider;
}

export function fromComposioApp(slug: string): string {
  return COMPOSIO_TO_PROVIDER[slug] || slug;
}

// Cache auth_config_id per toolkit slug — permanent per project, created once.
const authConfigCache = new Map<string, string>();

async function getOrCreateAuthConfig(toolkitSlug: string): Promise<string> {
  const cached = authConfigCache.get(toolkitSlug);
  if (cached) return cached;

  const client = getClient();

  // Check if one already exists for this project
  const existing = await client.authConfigs.list({ toolkit_slug: toolkitSlug, limit: 1 } as any);
  const existingItems = (existing as any).items ?? [];
  if (existingItems.length > 0) {
    const id = existingItems[0].id as string;
    authConfigCache.set(toolkitSlug, id);
    return id;
  }

  // Create a Composio-managed auth config (Composio's verified OAuth app)
  const created = await client.authConfigs.create({
    toolkit: { slug: toolkitSlug },
    auth_config: { type: 'use_composio_managed_auth' },
  });

  const id = created.auth_config.id;
  authConfigCache.set(toolkitSlug, id);
  return id;
}

/**
 * Initiate a Composio OAuth connection for a tenant.
 * Returns the Composio redirect URL — users complete OAuth there.
 * After OAuth, Composio redirects to callbackUrl.
 */
export async function initiateComposioConnection(
  tenantId: string,
  provider: string,
  callbackUrl: string
): Promise<string> {
  const toolkitSlug = toComposioApp(provider);
  const authConfigId = await getOrCreateAuthConfig(toolkitSlug);

  const client = getClient();
  const link = await client.link.create({
    auth_config_id: authConfigId,
    user_id: tenantId,
    callback_url: callbackUrl,
  });

  if (!link.redirect_url) {
    throw new Error(`Composio did not return a redirect URL for ${provider}`);
  }
  return link.redirect_url;
}

/**
 * Get all AF provider keys a tenant has active connections for.
 */
export async function getComposioConnectedProviders(tenantId: string): Promise<string[]> {
  try {
    const client = getClient();
    const result = await client.connectedAccounts.list({
      user_id: tenantId,
      status: 'ACTIVE',
      limit: 50,
    } as any);
    const items = (result as any).items ?? [];
    return items
      .map((c: any) => fromComposioApp(c.toolkit?.slug ?? c.toolkit_slug ?? ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Kept for interface compat — not used; Composio manages tokens internally via user_id.
export async function getComposioToken(
  _tenantId: string,
  _provider: string
): Promise<string | null> {
  return null;
}

/**
 * Register an API key / bearer token credential directly with Composio
 * without going through an OAuth redirect. Supports API_KEY and BEARER_TOKEN
 * auth schemes — Composio stores the credential and makes it available for
 * action execution, exactly the same as an OAuth-connected account.
 */
export async function createComposioApiKeyConnection(
  tenantId: string,
  provider: string,
  apiKey: string,
): Promise<void> {
  const toolkitSlug = toComposioApp(provider);
  const authConfigId = await getOrCreateAuthConfig(toolkitSlug);
  const client = getClient();

  // Try API_KEY scheme first (most common for API-key-only services).
  // Fall back to BEARER_TOKEN if API_KEY creation fails.
  try {
    await client.connectedAccounts.create({
      auth_config: { id: authConfigId },
      connection: {
        user_id: tenantId,
        state: {
          authScheme: 'API_KEY',
          val: { api_key: apiKey, generic_api_key: apiKey },
        },
      } as any,
    });
    return;
  } catch (err) {
    console.warn(`[Composio] API_KEY scheme failed for ${provider}, trying BEARER_TOKEN:`, (err as Error).message);
  }

  await client.connectedAccounts.create({
    auth_config: { id: authConfigId },
    connection: {
      user_id: tenantId,
      state: {
        authScheme: 'BEARER_TOKEN',
        val: { token: apiKey },
      },
    } as any,
  });
}
