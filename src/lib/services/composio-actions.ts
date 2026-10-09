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
  // ── Paid advertising platforms ──
  google_ads: 'googleads',
  google_analytics: 'googleanalytics',
  facebook_ads: 'facebookads',
  // ── Content & video platforms ──
  youtube: 'youtube',
  buffer: 'buffer',
  canva: 'canva',
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
  box: 'box',
  square: 'squareapp',
};

// v3.1 tools API response shape
interface ComposioTool {
  slug: string;
  name: string;
  description: string;
  toolkit?: { slug?: string; name?: string };
  input_parameters?: {
    properties?: Record<string, { type?: string; description?: string; title?: string }>;
    required?: string[];
  };
}

// Seen live: GitHub file contents came back as a presigned download URL, and agents output the URL.
const LARGE_CONTENT_NOTE = `LARGE CONTENT: Composio may return big payloads (file contents, attachments, exports) as a presigned download URL instead of inline data. If the field you need holds a URL rather than the content (e.g. an s3/storage https link), download it with requests.get(url, timeout=30) and use the response text/bytes — the presigned URL itself needs no auth header and must not be passed on as the result.`;

// Cache all actions per app for 30 minutes — action lists rarely change
const schemaCache: Map<string, { data: string; expiresAt: number }> = new Map();

/**
 * Paginate through ALL Composio actions for an app.
 * No filter_important_actions, no hard limit — fetches every available action.
 */
async function fetchAllActionsForApp(appName: string, apiKey: string): Promise<ComposioTool[]> {
  const cached = schemaCache.get(appName);
  if (cached && cached.expiresAt > Date.now()) return JSON.parse(cached.data);

  const bySlug = new Map<string, ComposioTool>();
  // Composio's tools API pages with cursor/next_cursor (max 1000 per page) and has no offset
  // parameter — paging by offset re-fetched the first page, so large toolkits (GitHub, HubSpot,
  // Slack...) only ever exposed their first 100 actions, padded with duplicates.
  const PAGE_SIZE = 1000;
  let cursor: string | null = null;

  try {
    for (let page = 0; page < 20; page++) {
      const url = `${COMPOSIO_API_BASE}/api/v3.1/tools?toolkit_slug=${appName}&limit=${PAGE_SIZE}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const res = await fetch(url, {
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        console.warn(`[composio-actions] ${appName} page=${page}: HTTP ${res.status}`);
        break;
      }

      const data = await res.json() as { items?: ComposioTool[]; next_cursor?: string | null };
      const before = bySlug.size;
      for (const item of data.items ?? []) bySlug.set(item.slug, item);

      // Stop at the last page, and defensively if a page added nothing new.
      if (!data.next_cursor || bySlug.size === before) break;
      cursor = data.next_cursor;
    }
    const allActions = [...bySlug.values()];

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

// ── Toolkits straight from Composio's catalog ─────────────────────────────
// Connectors used to be resolved through hand-kept maps, so "Zoho Books" became Zoho CRM (the only
// Zoho entry): a financial-statements mission got CRM actions and CRM permissions and every Books
// call failed on scope. Toolkits and the toolkit an action belongs to now come from Composio itself.

export interface ToolkitMatch { slug: string; name: string }

const toolkitSearchCache = new Map<string, { items: ToolkitMatch[]; expiresAt: number }>();

/** Composio toolkits matching a product name, from Composio's own catalog. */
export async function searchComposioToolkits(query: string, limit = 8): Promise<ToolkitMatch[]> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  const q = query.trim().toLowerCase();
  if (!apiKey || !q) return [];
  const cached = toolkitSearchCache.get(q);
  if (cached && cached.expiresAt > Date.now()) return cached.items;
  try {
    const res = await fetch(`${COMPOSIO_API_BASE}/api/v3.1/toolkits?search=${encodeURIComponent(q)}&limit=${limit}`, {
      headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { items?: Array<{ slug?: string; name?: string }> };
    const items = (data.items ?? []).filter(t => t.slug).map(t => ({ slug: t.slug!, name: t.name ?? t.slug! }));
    toolkitSearchCache.set(q, { items, expiresAt: Date.now() + 60 * 60 * 1000 });
    return items;
  } catch {
    return [];
  }
}

/** The toolkit a product name means — only an exact name or slug match, never a near miss (Zoho CRM is not Zoho Books). */
export function pickToolkit(productName: string, candidates: ToolkitMatch[]): string | undefined {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = norm(productName);
  return (candidates.find(c => norm(c.name) === wanted) ?? candidates.find(c => norm(c.slug) === wanted))?.slug;
}

const actionToolkitCache = new Map<string, string>();

/** The toolkit an action belongs to, as Composio records it: ZOHO_BOOKS_* is zoho_books, not zoho. */
export async function toolkitForAction(action: string): Promise<string | null> {
  const key = action.toUpperCase();
  const cached = actionToolkitCache.get(key);
  if (cached) return cached;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${COMPOSIO_API_BASE}/api/v3.1/tools/${encodeURIComponent(key)}`, {
      headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { toolkit?: { slug?: string } };
    const slug = data.toolkit?.slug?.toLowerCase();
    if (slug) actionToolkitCache.set(key, slug);
    return slug ?? null;
  } catch {
    return null;
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
 * Action hint for repairing a failed script. Full catalogs (GitHub alone has hundreds of
 * actions) made each repair call cost ~300 credits, so only the actions the script called and
 * their closest name matches get descriptions; every other action is listed by slug only.
 */
export async function buildComposioFixContext(usedSlugs: string[], detailedLimit = 40): Promise<string> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey || usedSlugs.length === 0) return '';

  const used = new Set(usedSlugs.map(s => s.toUpperCase()));
  const usedTokens = new Set([...used].flatMap(s => s.split('_').slice(1)));
  // The toolkit each action belongs to, from Composio — guessing from the first word sent a Zoho
  // Books script's fixer only Zoho CRM's actions.
  const appNames = [...new Set(await Promise.all([...used].map(async s => {
    const prefix = s.split('_')[0].toLowerCase();
    return (await toolkitForAction(s)) ?? AF_TO_COMPOSIO_APP[prefix] ?? prefix;
  })))];

  const results = await Promise.allSettled(appNames.map(app => fetchAllActionsForApp(app, apiKey)));
  const actions = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
  if (actions.length === 0) return '';

  const ranked = actions
    .map(a => {
      const slug = a.slug.toUpperCase();
      const overlap = slug.split('_').slice(1).filter(t => usedTokens.has(t)).length;
      return { a, score: used.has(slug) ? 1000 : overlap };
    })
    .sort((x, y) => y.score - x.score);
  const detailed = ranked.filter(x => x.score > 0).slice(0, detailedLimit).map(x => x.a);
  const detailedSlugs = new Set(detailed.map(a => a.slug));
  const others = actions.filter(a => !detailedSlugs.has(a.slug)).map(a => a.slug);

  return `COMPOSIO ACTIONS — the only valid names. Closest matches to what the script called (slug — description [req: required_params]):
${detailed.map(formatActionCompact).join('')}${others.length ? `Other valid action names: ${others.join(', ')}\n` : ''}
${LARGE_CONTENT_NOTE}`;
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

NO ACTION FOR IT? Some toolkits lack whole areas (Zoho Books has no report actions — no P&L, balance sheet or trial balance). Then call the app's own REST API through the customer's connection — never invent an action name, and never fall back to approximating the data:
  from agenticfactor._core import composio_proxy
  pnl = composio_proxy("zoho_books", "GET", "/reports/profitandloss", params={"organization_id": org_id, "from_date": "2025-04-01", "to_date": "2026-03-31"})
The first argument is the toolkit slug; the path is relative to the app's API base, as in the app's REST API docs. GET reads run in previews; POST/PUT/PATCH/DELETE are writes and go through approval like composio_execute writes.
FILES the script generates (an .xlsx built with openpyxl, a .pdf, an image) are uploaded the same way, as raw bytes — e.g. to the customer's Google Drive:
  f = composio_proxy("googledrive", "POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=media", binary=data, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  composio_proxy("googledrive", "PATCH", f"https://www.googleapis.com/drive/v3/files/{f['id']}", body={"name": "Report.xlsx"})

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
${LARGE_CONTENT_NOTE}

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
