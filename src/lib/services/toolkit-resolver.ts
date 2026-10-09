/**
 * Which Composio toolkits a mission needs, decided from Composio's catalog rather than hand-kept
 * keyword maps. "Zoho Books" used to resolve to Zoho CRM (the only Zoho entry), so a
 * financial-statements mission was built with CRM actions and CRM permissions and every Books
 * call failed on scope. Any toolkit Composio offers now works the same way: the architect sees its
 * real actions even before it is connected, and the permissions follow the actions scripts call.
 */
import { callLLM } from './llm-router';
import { robustJSONParse } from '../utils/json-parser';
import { AF_TO_COMPOSIO_APP, pickToolkit, searchComposioToolkits, toolkitForAction } from './composio-actions';

export interface RequestedToolkit { name: string; slug?: string }

const APPS_PROMPT = `List the third-party apps or products this request reads from or writes to, by product name as the customer wrote it (e.g. "Zoho Books", "Google Sheets", "Slack"). Only named products — not generic things like email, AI, the web or a spreadsheet unless a product is named. Return {"apps": ["..."]}.`;

/** Product names in the request, each resolved to a Composio toolkit slug when one matches exactly. */
export async function requestedToolkits(text: string, tenantId?: string): Promise<RequestedToolkit[]> {
  const res = await callLLM(
    [{ role: 'system', content: APPS_PROMPT }, { role: 'user', content: text.slice(0, 8000) }],
    { jsonMode: true, temperature: 0, tier: 3, ...(tenantId ? { budgetContext: { tenantId, missionId: 'blueprint_generation' } } : {}) },
  );
  let apps: unknown = [];
  try { apps = robustJSONParse(res.content)?.apps; } catch { /* no list */ }
  const names = Array.isArray(apps)
    ? [...new Set(apps.filter((a): a is string => typeof a === 'string' && a.trim().length > 1).map(a => a.trim()))].slice(0, 8)
    : [];
  return Promise.all(names.map(async name => ({ name, slug: pickToolkit(name, await searchComposioToolkits(name)) })));
}

export function toolkitSlugs(requested: RequestedToolkit[]): string[] {
  return requested.flatMap(r => (r.slug ? [r.slug] : []));
}

function composioSlug(provider: string): string {
  return (AF_TO_COMPOSIO_APP[provider] ?? provider).toLowerCase();
}

/** What the architect is told about each named product: its toolkit and whether it is connected. */
export function toolkitNotice(requested: RequestedToolkit[], connectedProviders: string[]): string {
  if (requested.length === 0) return '';
  const connected = new Set(connectedProviders.map(composioSlug));
  const lines = requested.map(r => {
    if (!r.slug) return `- "${r.name}" → no Composio toolkit with this name`;
    if (connected.has(r.slug)) return `- "${r.name}" → ${r.slug} (connected)`;
    return `- "${r.name}" → ${r.slug} — NOT connected yet: use its actions listed above and declare {"type": "composio_oauth", "service": "${r.slug}", "scope": "<the actions you call>"}; the customer connects it before running`;
  });
  return `\n\nTOOLKITS THIS REQUEST NAMES (resolved in the Composio catalog):\n${lines.join('\n')}\nBuild with exactly these toolkits. Never substitute a related product (Zoho CRM for Zoho Books, Outlook for Gmail): it holds different data and needs different permissions.`;
}

// The legacy "google" permission stands for every Google toolkit.
const UMBRELLA: Record<string, string[]> = { google: ['gmail', 'googlesheets', 'googledocs', 'googledrive', 'googlecalendar'] };

type Permission = { type: string; service: string; scope: string; confidentialityLevel: string; granted?: boolean };

export function permissionCovers(service: string, toolkit: string): boolean {
  const s = service.toLowerCase().trim();
  return s === toolkit || composioSlug(s) === toolkit || (UMBRELLA[s] ?? []).includes(toolkit);
}

/**
 * Declares a composio_oauth permission for every toolkit whose actions the scripts call but no
 * permission covers, using the toolkit Composio records for each action.
 */
export async function declareCalledToolkits(
  scripts: string[],
  permissions: Permission[],
  connectedProviders: string[],
  lookup: (action: string) => Promise<string | null> = toolkitForAction,
): Promise<Permission[]> {
  const actions = [...new Set(scripts.flatMap(code => [...code.matchAll(/composio_execute\s*\(\s*["']([A-Z][A-Z0-9_]{3,})["']/g)].map(m => m[1])))];
  const byToolkit = new Map<string, string[]>();
  await Promise.all(actions.map(async action => {
    const toolkit = await lookup(action);
    if (toolkit) byToolkit.set(toolkit, [...(byToolkit.get(toolkit) ?? []), action]);
  }));
  // composio_proxy("zoho_books", "GET", ...) names its toolkit directly.
  for (const code of scripts) {
    for (const m of code.matchAll(/composio_proxy\(\s*["']([A-Za-z0-9_]+)["']\s*,\s*["']([A-Za-z]+)["'](?:\s*,\s*f?["']([^"']*)["'])?/g)) {
      const toolkit = m[1].toLowerCase();
      byToolkit.set(toolkit, [...(byToolkit.get(toolkit) ?? []), `PROXY ${m[2].toUpperCase()} ${m[3] ?? ''}`.trim()]);
    }
  }
  const connected = new Set(connectedProviders.map(composioSlug));
  const result = [...permissions];
  for (const [toolkit, used] of byToolkit) {
    if (result.some(p => permissionCovers(p.service, toolkit))) continue;
    result.push({ type: 'composio_oauth', service: toolkit, scope: used.sort().join(','), confidentialityLevel: 'confidential', granted: connected.has(toolkit) });
  }
  return result;
}
