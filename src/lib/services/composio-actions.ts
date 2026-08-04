/**
 * Fetch Composio action schemas for the tenant's connected providers.
 * Returns a formatted string injected into the LLM system prompt so the
 * LLM knows the exact action names and parameters to use.
 */

const COMPOSIO_API_BASE = 'https://backend.composio.dev';

// Maps AF/Supabase provider keys → Composio app slugs
export const AF_TO_COMPOSIO_APP: Record<string, string> = {
  google: 'gmail',
  slack: 'slack',
  github: 'github',
  notion: 'notion',
  discord: 'discord',
  linkedin_oidc: 'linkedin',
  twitter: 'twitter',
  facebook: 'facebook',
  instagram: 'instagram',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  airtable: 'airtable',
  asana: 'asana',
  zoho: 'zoho',
  atlassian: 'jira',
  microsoft: 'outlook',
  dropbox: 'dropbox',
  monday: 'mondaydotcom',
  linear: 'linear',
  intercom: 'intercom',
  paypal: 'paypal',
  mailchimp: 'mailchimp',
  reddit: 'reddit',
  shopify: 'shopify',
  stripe: 'stripe',
  zendesk: 'zendesk',
};

// v3.1 tools API response shape
interface ComposioTool {
  slug: string;        // action name, e.g. "GMAIL_SEND_EMAIL"
  name: string;        // human-readable, e.g. "Send Email"
  description: string;
  input_parameters?: {
    properties?: Record<string, { type?: string; description?: string; title?: string }>;
    required?: string[];
  };
}

// Cache schemas in-process for 10 minutes to avoid redundant API calls
const schemaCache: Map<string, { data: string; expiresAt: number }> = new Map();

async function fetchActionsForApp(appName: string, apiKey: string): Promise<ComposioTool[]> {
  const cached = schemaCache.get(appName);
  if (cached && cached.expiresAt > Date.now()) return JSON.parse(cached.data);

  try {
    const url = `${COMPOSIO_API_BASE}/api/v3.1/tools?toolkit_slug=${appName}&limit=30&filter_important_actions=true`;
    const res = await fetch(url, {
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[composio-actions] Failed to fetch ${appName}: HTTP ${res.status}`);
      return [];
    }

    const data = await res.json() as { items?: ComposioTool[] };
    const items = data.items ?? [];

    schemaCache.set(appName, {
      data: JSON.stringify(items),
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return items;
  } catch (err) {
    console.warn(`[composio-actions] Error fetching ${appName}:`, err);
    return [];
  }
}

function formatActionSchema(action: ComposioTool): string {
  const props = action.input_parameters?.properties ?? {};
  const required = new Set(action.input_parameters?.required ?? []);
  const params = Object.entries(props)
    .slice(0, 6)
    .map(([key, schema]) => {
      const s = schema as { type?: string; description?: string; title?: string };
      const req = required.has(key) ? '' : '?';
      const desc = s.description || s.title || '';
      return `      ${key}${req}: ${s.type ?? 'any'}${desc ? ` — ${desc}` : ''}`;
    })
    .join('\n');

  return `  ${action.slug} — ${action.description || action.name}\n${params ? params + '\n' : ''}`;
}

/**
 * Fetch Composio action schemas for a list of AF provider keys and format
 * them as a concise system-prompt section.
 *
 * Returns '' if COMPOSIO_API_KEY is not set or all fetches fail — the caller
 * should degrade gracefully to existing api.call() instructions.
 */
export async function buildComposioActionsContext(afProviders: string[]): Promise<string> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey || afProviders.length === 0) return '';

  const appNames = [...new Set(
    afProviders.map(p => AF_TO_COMPOSIO_APP[p]).filter(Boolean)
  )];

  if (appNames.length === 0) return '';

  const results = await Promise.allSettled(
    appNames.map(app => fetchActionsForApp(app, apiKey))
  );

  const sections: string[] = [];

  for (let i = 0; i < appNames.length; i++) {
    const res = results[i];
    if (res.status !== 'fulfilled' || res.value.length === 0) continue;

    const app = appNames[i];
    const afProvider = Object.entries(AF_TO_COMPOSIO_APP).find(([, v]) => v === app)?.[0] ?? app;
    const header = `${app.toUpperCase()} (provider: ${afProvider})`;
    const body = res.value.map(formatActionSchema).join('');
    sections.push(`${header}:\n${body}`);
  }

  if (sections.length === 0) return '';

  return `\n\nCOMPOSIO ACTIONS (PREFERRED for connected providers — use composio_execute() instead of api.call()):
RULE: Whenever an agent needs to interact with the services listed below, call composio_execute(action_name, params) from agenticfactor._core. It handles auth automatically via the tenant's Composio connection — no token needed.

Python usage:
  from agenticfactor._core import composio_execute
  result = composio_execute("GMAIL_SEND_EMAIL", {"recipient_email": "...", "subject": "...", "body": "..."})

Available actions for this tenant's connected apps (? = optional param):
${sections.join('\n')}
NOTE: Required params have no ?, optional params have ?. Never guess action names — only use names from the list above.`;
}
