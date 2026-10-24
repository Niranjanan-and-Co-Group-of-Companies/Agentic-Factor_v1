// Official names, logos and descriptions of apps (Composio toolkits) and the titles of their actions,
// straight from Composio's catalog — for every one of its apps, with nothing listed by hand. A mission's
// apps and actions come from its own blueprint; this supplies how to show them.
//
// Lookups are cached twice: in memory for this server instance, and in the shared fetch cache (one
// copy for every instance, refreshed daily), so new apps and renamed actions appear on their own.

import { appName, humanizeAction } from '@/lib/utils/app-name';
import { AF_TO_COMPOSIO_APP } from '@/lib/services/composio-actions';

const COMPOSIO = 'https://backend.composio.dev';
const LOGO_CDN = 'https://logos.composio.dev/api';
const DAY_S = 24 * 60 * 60;

export interface AppInfo { slug: string; name: string; logo: string; description: string; /** Composio's catalog has this app. */ known: boolean }
export interface ActionInfo { slug: string; title: string; description: string; toolkit: string | null }

/** How a mission's apps and actions are shown, resolved from its blueprint and Composio's catalog. */
export interface MissionCatalog {
  apps: Record<string, AppInfo>;
  /** Action slug → "App: Official title". */
  actionLabels: Record<string, string>;
  /** Agent id → the toolkit slugs it works in, in the order the blueprint names them. */
  agentApps: Record<string, string[]>;
}

const memory = new Map<string, { value: unknown; until: number }>();

async function composioGet<T>(path: string): Promise<T | null> {
  const hit = memory.get(path);
  if (hit && hit.until > Date.now()) return hit.value as T | null;
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${COMPOSIO}${path}`, {
      headers: { 'x-api-key': key },
      next: { revalidate: DAY_S },
      signal: AbortSignal.timeout(5000),
    });
    // Unknown slugs are remembered too (as null), so they are not asked for on every poll.
    const value = res.ok ? await res.json() as T : null;
    if (res.ok || res.status === 404) memory.set(path, { value, until: Date.now() + DAY_S * 1000 });
    return value;
  } catch {
    return null;
  }
}

const fallbackApp = (slug: string): AppInfo => ({ slug, name: appName(slug), logo: `${LOGO_CDN}/${slug}`, description: '', known: false });

type ToolkitRow = { slug?: string; name?: string; meta?: { logo?: string; description?: string } };
const toolkit = (slug: string) => composioGet<ToolkitRow>(`/api/v3/toolkits/${encodeURIComponent(slug)}`);

/** An app's official name, logo and description; a readable fallback when Composio doesn't know it. */
export async function getAppInfo(slug: string): Promise<AppInfo> {
  const s = slug.toLowerCase();
  let tk = await toolkit(s);
  // Some connections use the platform's own provider name (e.g. "linkedin_oidc"); show the app behind it.
  if (!tk?.name && AF_TO_COMPOSIO_APP[s] && AF_TO_COMPOSIO_APP[s] !== s) tk = await toolkit(AF_TO_COMPOSIO_APP[s]);
  if (!tk?.name) return fallbackApp(s);
  const logoSlug = tk.slug?.toLowerCase() || s;
  return { slug: s, name: tk.name, logo: tk.meta?.logo || `${LOGO_CDN}/${logoSlug}`, description: tk.meta?.description ?? '', known: true };
}

export interface CatalogOverview { /** Apps that can be connected. */ total: number; popular: string[]; categories: string[] }

/** The whole catalog in brief — how many apps, the most used, the categories — refreshed daily. */
export async function catalogOverview(): Promise<CatalogOverview | null> {
  const [list, categories] = await Promise.all([
    composioGet<{ total_items?: number; items?: Array<{ name?: string }> }>('/api/v3.1/toolkits?limit=40&sort_by=usage'),
    composioGet<{ items?: Array<{ name?: string }> }>('/api/v3.1/toolkits/categories'),
  ]);
  if (!list?.total_items) return null;
  return {
    total: list.total_items,
    popular: (list.items ?? []).map(i => i.name ?? '').filter(Boolean),
    categories: (categories?.items ?? []).map(c => c.name ?? '').filter(Boolean),
  };
}

export interface CatalogMatch { slug: string; name: string; description: string; categories: string[] }

/** Apps matching a name, a purpose ("accounting", "send WhatsApp messages") or a category; and how many there are. */
export async function searchCatalog(query: string, opts: { category?: string; limit?: number } = {}): Promise<{ total: number; apps: CatalogMatch[] } | null> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 15), sort_by: 'usage' });
  if (query) params.set('search', query);
  if (opts.category) params.set('category', opts.category);
  type Row = { slug?: string; name?: string; meta?: { description?: string; categories?: Array<{ name?: string }> } };
  const res = await composioGet<{ total_items?: number; items?: Row[] }>(`/api/v3.1/toolkits?${params}`);
  if (!res) return null;
  return {
    total: res.total_items ?? res.items?.length ?? 0,
    apps: (res.items ?? []).filter(r => r.slug && r.name).map(r => ({
      slug: r.slug!.toLowerCase(), name: r.name!, description: (r.meta?.description ?? '').slice(0, 140),
      categories: (r.meta?.categories ?? []).map(c => c.name ?? '').filter(Boolean),
    })),
  };
}

/** An action's official title, description and app; a readable fallback from its name otherwise. */
export async function getActionInfo(slug: string): Promise<ActionInfo> {
  const s = slug.toUpperCase();
  const t = await composioGet<{ slug?: string; name?: string; description?: string; toolkit?: { slug?: string } }>(`/api/v3.1/tools/${encodeURIComponent(s)}`);
  if (!t?.name) return { slug: s, title: humanizeAction(s).split(': ').slice(1).join(': ') || s, description: '', toolkit: null };
  return { slug: s, title: t.name, description: t.description ?? '', toolkit: t.toolkit?.slug?.toLowerCase() ?? null };
}

export async function getAppInfos(slugs: string[]): Promise<Record<string, AppInfo>> {
  const unique = [...new Set(slugs.map(s => s.toLowerCase()).filter(Boolean))];
  const infos = await Promise.all(unique.map(getAppInfo));
  return Object.fromEntries(infos.map(i => [i.slug, i]));
}

/** "Zoho Books", "zoho_books", "ZohoBooks" all compare equal. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface BlueprintLike {
  permissions?: Array<{ type?: string; service?: string; scope?: string }>;
  agents?: Array<{ id: string; tools?: Array<{ name?: string }>; pythonScript?: string }>;
}

/** Action slugs a script calls, and the toolkits it reaches through the proxy. */
function scriptCalls(script: string): { actions: string[]; proxied: string[] } {
  return {
    actions: [...new Set([...script.matchAll(/composio_execute\s*\(\s*["']([A-Z][A-Z0-9_]{3,})["']/g)].map(m => m[1]))],
    proxied: [...new Set([...script.matchAll(/composio_proxy\(\s*["']([A-Za-z0-9_]+)["']/g)].map(m => m[1].toLowerCase()))],
  };
}

/** Action slugs the mission is allowed to use (its permissions), for labelling approvals ahead of time. */
export function declaredActions(mission: BlueprintLike | null | undefined): string[] {
  const out = new Set<string>();
  for (const p of mission?.permissions ?? []) {
    for (const s of String(p.scope ?? '').split(',')) if (/^[A-Z][A-Z0-9_]{3,}$/.test(s.trim())) out.add(s.trim());
  }
  return [...out];
}

/**
 * The mission's apps (from its permissions), which agent works in which app (the apps each agent's
 * blueprint names, matched to those official names; then what its script calls), and labels for the
 * given actions. Agents whose blueprint names no app keep an empty list: the platform does that step.
 */
export async function missionCatalog(mission: BlueprintLike | null | undefined, actionSlugs: string[] = []): Promise<MissionCatalog> {
  const declared = (mission?.permissions ?? []).filter(p => p.type === 'composio_oauth' && p.service).map(p => p.service!.toLowerCase());
  const scripts = (mission?.agents ?? []).map(a => ({ id: a.id, ...scriptCalls(a.pythonScript ?? '') }));
  const apps = await getAppInfos([...declared, ...scripts.flatMap(s => s.proxied)]);
  const kits = Object.keys(apps).sort((a, b) => b.length - a.length);
  const kitOfAction = (slug: string) => kits.find(k => slug.startsWith(`${k.toUpperCase()}_`));

  const agentApps: Record<string, string[]> = {};
  for (const agent of mission?.agents ?? []) {
    const found: string[] = [];
    for (const tool of agent.tools ?? []) {
      const n = norm(tool.name ?? '');
      const match = n && Object.values(apps).find(a => norm(a.name) === n || norm(a.slug) === n);
      if (match && !found.includes(match.slug)) found.push(match.slug);
    }
    const calls = scripts.find(s => s.id === agent.id);
    for (const slug of [...(calls?.proxied ?? []), ...(calls?.actions ?? []).map(kitOfAction).filter((k): k is string => !!k)]) {
      if (!found.includes(slug)) found.push(slug);
    }
    agentApps[agent.id] = found;
  }

  const wanted = [...new Set(actionSlugs.filter(a => /^[A-Z][A-Z0-9_]{3,}$/.test(a)))];
  const infos = await Promise.all(wanted.map(getActionInfo));
  const actionLabels: Record<string, string> = {};
  for (const info of infos) {
    const kit = info.toolkit ?? kitOfAction(info.slug) ?? null;
    const app = kit ? (apps[kit] ?? (await getAppInfo(kit))) : null;
    if (app && !apps[app.slug]) apps[app.slug] = app;
    actionLabels[info.slug] = app ? `${app.name}: ${info.title}` : humanizeAction(info.slug, kits);
  }
  return { apps, actionLabels, agentApps };
}

/** The display label for an action: the catalog's when known, a readable fallback otherwise. */
export function actionLabel(slug: string, catalog: Pick<MissionCatalog, 'actionLabels' | 'apps'> | null): string {
  if (!/^[A-Z0-9_]+$/.test(slug)) return slug;
  return catalog?.actionLabels[slug.toUpperCase()] ?? humanizeAction(slug, Object.keys(catalog?.apps ?? {}));
}

/** A labeler for a mission's actions (resolves the given slugs' official titles first). */
export async function missionActionLabeler(mission: BlueprintLike | null | undefined, slugs: string[]): Promise<(slug: string) => string> {
  const catalog = await missionCatalog(mission, slugs);
  return slug => actionLabel(slug, catalog);
}
