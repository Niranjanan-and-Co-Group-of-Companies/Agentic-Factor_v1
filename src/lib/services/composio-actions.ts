/**
 * Fetch ALL Composio action schemas for the tenant's connected providers.
 * Paginates until every action is retrieved — no filter, no arbitrary limit.
 * Returns a formatted string injected into the LLM system prompt so the LLM
 * knows the exact action names to use, and exports a Set of valid names for
 * post-generation validation in intake.ts.
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
  slug: string;
  name: string;
  description: string;
  input_parameters?: {
    properties?: Record<string, { type?: string; description?: string; title?: string }>;
    required?: string[];
  };
}

// Cache all actions per app for 30 minutes — action lists rarely change
const schemaCache: Map<string, { data: string; expiresAt: number }> = new Map();

/**
 * Paginate through ALL Composio actions for an app.
 * No filter_important_actions, no hard limit — fetches every available action.
 */
async function fetchAllActionsForApp(appName: string, apiKey: string): Promise<ComposioTool[]> {
  const cached = schemaCache.get(appName);
  if (cached && cached.expiresAt > Date.now()) return JSON.parse(cached.data);

  const allActions: ComposioTool[] = [];
  const PAGE_SIZE = 100;
  let offset = 0;

  try {
    while (true) {
      const url = `${COMPOSIO_API_BASE}/api/v3.1/tools?toolkit_slug=${appName}&limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await fetch(url, {
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        console.warn(`[composio-actions] ${appName} offset=${offset}: HTTP ${res.status}`);
        break;
      }

      const data = await res.json() as { items?: ComposioTool[] };
      const items = data.items ?? [];
      allActions.push(...items);

      // Last page reached when fewer items returned than requested
      if (items.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;

      // Safety ceiling — Composio apps shouldn't exceed this
      if (allActions.length >= 5000) {
        console.warn(`[composio-actions] ${appName} hit 5000-action safety limit`);
        break;
      }
    }

    schemaCache.set(appName, {
      data: JSON.stringify(allActions),
      expiresAt: Date.now() + 30 * 60 * 1000,
    });

    console.log(`[composio-actions] Fetched ${allActions.length} actions for ${appName}`);
    return allActions;
  } catch (err) {
    console.warn(`[composio-actions] Error fetching ${appName}:`, err);
    return [];
  }
}

// Compact format: slug — description [req: param1:type, param2:type]
// Includes type hints on required params so the LLM passes the right shape, not just the right name.
function formatActionCompact(action: ComposioTool): string {
  const props = action.input_parameters?.properties ?? {};
  const required = action.input_parameters?.required ?? [];
  const reqParams = required.slice(0, 6).map(p => {
    const t = props[p]?.type;
    return t ? `${p}:${t}` : p;
  }).join(', ');
  const reqHint = reqParams ? ` [req: ${reqParams}]` : '';
  const desc = (action.description || action.name).slice(0, 90);
  return `  ${action.slug} — ${desc}${reqHint}\n`;
}

/**
 * Returns the full schema map (action slug → ComposioTool) for the given AF providers.
 * Used by intake.ts for parameter-name validation after blueprint generation.
 */
export async function getComposioActionSchemas(afProviders: string[]): Promise<Map<string, ComposioTool>> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey || afProviders.length === 0) return new Map();

  const appNames = [...new Set(afProviders.map(p => AF_TO_COMPOSIO_APP[p] ?? p))];
  const results = await Promise.allSettled(appNames.map(app => fetchAllActionsForApp(app, apiKey)));

  const schemaMap = new Map<string, ComposioTool>();
  for (const res of results) {
    if (res.status === 'fulfilled') {
      for (const action of res.value) schemaMap.set(action.slug, action);
    }
  }
  return schemaMap;
}

/**
 * Returns the complete set of valid Composio action names for the given AF providers.
 * Used by intake.ts to validate action names in generated Python scripts.
 */
export async function getValidComposioActionNames(afProviders: string[]): Promise<Set<string>> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey || afProviders.length === 0) return new Set();

  const appNames = [...new Set(afProviders.map(p => AF_TO_COMPOSIO_APP[p] ?? p))];
  const results = await Promise.allSettled(appNames.map(app => fetchAllActionsForApp(app, apiKey)));

  const names = new Set<string>();
  for (const res of results) {
    if (res.status === 'fulfilled') {
      for (const action of res.value) names.add(action.slug);
    }
  }
  return names;
}

/**
 * Fetch all Composio action schemas for the tenant's connected providers and
 * format them as a concise system-prompt section.
 *
 * Returns '' if COMPOSIO_API_KEY is not set or all fetches fail.
 */
export async function buildComposioActionsContext(afProviders: string[]): Promise<string> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey || afProviders.length === 0) return '';

  const appNames = [...new Set(afProviders.map(p => AF_TO_COMPOSIO_APP[p] ?? p))];
  if (appNames.length === 0) return '';

  const results = await Promise.allSettled(appNames.map(app => fetchAllActionsForApp(app, apiKey)));

  const sections: string[] = [];
  const connectedSlugs: string[] = [];

  for (let i = 0; i < appNames.length; i++) {
    const res = results[i];
    if (res.status !== 'fulfilled' || res.value.length === 0) continue;

    const app = appNames[i];
    const afProvider = Object.entries(AF_TO_COMPOSIO_APP).find(([, v]) => v === app)?.[0] ?? app;
    const header = `${app.toUpperCase()} (provider: ${afProvider}) — ${res.value.length} actions:`;
    const body = res.value.map(formatActionCompact).join('');
    sections.push(`${header}\n${body}`);
    connectedSlugs.push(app);
  }

  if (sections.length === 0) return '';

  const slugList = connectedSlugs.join(', ');

  return `\n\nCOMPOSIO ACTIONS — use composio_execute() for ALL of these providers:
CRITICAL RULE: The action names below are the ONLY valid names. Copy them EXACTLY (ALL_CAPS_WITH_UNDERSCORES). NEVER invent, shorten, or guess a name — if the exact name is not in this list, it does not exist and will fail at runtime.

Python usage:
  from agenticfactor._core import composio_execute
  result = composio_execute("EXACT_ACTION_NAME", {"param": "value"})

All available actions for this tenant's connected apps (format: slug — description [req: required_params]):
${sections.join('\n')}
NOTE: Every action name used in composio_execute() MUST appear verbatim in the list above.

COMPOSIO CALL RULE — ABSOLUTE (applies to reads AND writes, every single interaction):
For ALL services listed above (${slugList}), you MUST use composio_execute() for EVERY call — lookups, searches, reads, and writes.
There is NO direct Bearer token available for Composio-managed services. Direct HTTP calls ALWAYS return 401.

✅ CORRECT — Trello: read board/list first, then create card (ALL via composio_execute):
  boards = composio_execute("TRELLO_GET_USER_BOARDS_ALL_BOARDS", {})
  board_list = boards if isinstance(boards, list) else boards.get("boards", [])
  board = next((b for b in board_list if "Action Items" in b.get("name", "")), board_list[0] if board_list else None)
  lists = composio_execute("TRELLO_GET_ALL_LISTS_OF_A_BOARD", {"board_id": board["id"]})
  list_items = lists if isinstance(lists, list) else lists.get("lists", [])
  composio_execute("TRELLO_CREATE_TRELLO_CARD", {"idList": list_items[0]["id"], "name": "Card Title", "desc": "..."})

❌ WRONG — direct REST (ALWAYS fails with 401 — no Trello token exists in env):
  _request("GET", "https://api.trello.com/1/members/me/boards", token=_get_token("trello"))
  api.call("trello", "GET", "/members/me/boards")
NEVER use api.call(), _request(), or any direct HTTP for these services: ${slugList}

PER-AGENT PROVIDER RULE (CRITICAL):
Each agent in the mission blueprint must handle EXACTLY ONE service.
- A Gmail agent: ONLY call GMAIL_* actions
- A Trello agent: ONLY call TRELLO_* actions
- A Slack agent: ONLY call SLACK_* actions
NEVER mix providers within a single agent's pythonScript. If data needs to cross services, use separate agents connected by edges.

COMPOSIO PERMISSIONS RULE (CRITICAL — overrides "custom_<slug>" for these services):
Connected services: ${slugList}
For ANY of these services, the permission entry MUST be:
  "type": "composio_oauth"
  "service": "<exact-slug>"  (lowercase slug, e.g. "trello", "youtube", "gmail")
  "scope": "<COMMA_SEPARATED_ACTION_SLUGS>"  (only the specific action slugs this agent calls)
  "confidentialityLevel": "internal"
DO NOT use "api_key", "oauth_token", or "custom_*" for these services.`;
}
