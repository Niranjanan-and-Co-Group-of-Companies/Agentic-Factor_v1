/**
 * Tool Registry — Dynamic per-mission toolbox
 *
 * Fetches Composio action schemas for every provider connected to a mission,
 * stores them in mission_tool_schemas, and at chat time loads them as native
 * Anthropic tool definitions so the LLM gets precise, reliable tools rather
 * than having to guess action slugs.
 *
 * Logo URLs come from the Composio logo CDN: https://logos.composio.dev/api/{slug}
 */

import { createServiceClient } from '@/lib/supabase/server';
import { AF_TO_COMPOSIO_APP } from './composio-actions';

const COMPOSIO_API_BASE = 'https://backend.composio.dev';
const LOGO_CDN = 'https://logos.composio.dev/api';
const MAX_TOOLS_PER_PROVIDER = 20;   // top N actions per connected provider
const STALENESS_HOURS = 24;          // re-fetch after this many hours

// ── Types ─────────────────────────────────────────────────────────────────

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface ToolMeta {
  actionName: string;
  providerSlug: string;
  displayName: string;
  logoUrl: string | null;
}

interface ComposioApiTool {
  slug: string;
  name: string;
  description: string;
  input_parameters?: {
    properties?: Record<string, { type?: string; description?: string; title?: string }>;
    required?: string[];
  };
}

// ── Always-present system tools (not from Composio) ───────────────────────

const SYSTEM_TOOLS: AnthropicTool[] = [
  {
    name: 'get_run_errors',
    description:
      'Read actual error messages and details from the most recent failed run of this mission. ' +
      'Call this whenever the user asks why it failed, what went wrong, or how to fix it.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

const SYSTEM_TOOL_META: ToolMeta[] = [
  { actionName: 'get_run_errors', providerSlug: 'system', displayName: 'Reading error logs', logoUrl: null },
];

// Hardcoded tools for API-key-only providers that aren't in Composio
const HARDCODED_PROVIDER_TOOLS: Record<string, AnthropicTool[]> = {
  tavily: [
    {
      name: 'TAVILY_SEARCH_WEB',
      description: 'Search the internet for current information, news, facts, or research on any topic. Returns relevant web results with titles and summaries.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          max_results: { type: 'number', description: 'Number of results (1-10, default 5)' },
        },
        required: ['query'],
      },
    },
  ],
  stripe: [
    {
      name: 'STRIPE_FETCH_CUSTOMER',
      description: 'Look up a Stripe customer by email address.',
      input_schema: { type: 'object', properties: { email: { type: 'string', description: 'Customer email' } }, required: ['email'] },
    },
    {
      name: 'STRIPE_LIST_RECENT_PAYMENTS',
      description: 'List the most recent Stripe payments or charges.',
      input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Number to return (max 20)' } }, required: [] },
    },
  ],
  sendgrid: [
    {
      name: 'SENDGRID_SEND_EMAIL',
      description: 'Send a transactional email via SendGrid.',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (plain text or HTML)' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  ],
  elevenlabs: [
    {
      name: 'ELEVENLABS_TEXT_TO_SPEECH',
      description: 'Convert text to speech using ElevenLabs.',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to convert to speech' },
          voice_id: { type: 'string', description: 'Voice ID to use' },
        },
        required: ['text'],
      },
    },
  ],
};

const HARDCODED_LOGO_OVERRIDES: Record<string, string> = {
  tavily: 'https://tavily.com/favicon.ico',
  sendgrid: 'https://logos.composio.dev/api/sendgrid',
  stripe: 'https://logos.composio.dev/api/stripe',
  elevenlabs: 'https://logos.composio.dev/api/elevenlabs',
  openai: 'https://logos.composio.dev/api/openai',
  anthropic: 'https://logos.composio.dev/api/anthropic',
};

// ── Composio fetch ─────────────────────────────────────────────────────────

async function fetchComposioTools(appSlug: string, apiKey: string): Promise<ComposioApiTool[]> {
  try {
    const url = `${COMPOSIO_API_BASE}/api/v3.1/tools?toolkit_slug=${appSlug}&limit=${MAX_TOOLS_PER_PROVIDER}&offset=0`;
    const res = await fetch(url, {
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[tool-registry] ${appSlug}: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json() as { items?: ComposioApiTool[] };
    return data.items ?? [];
  } catch (err) {
    console.warn(`[tool-registry] Error fetching ${appSlug}:`, err);
    return [];
  }
}

function composioToolToAnthropic(t: ComposioApiTool): AnthropicTool {
  const props: Record<string, { type: string; description?: string }> = {};
  const required: string[] = t.input_parameters?.required ?? [];
  for (const [k, v] of Object.entries(t.input_parameters?.properties ?? {})) {
    props[k] = {
      type: v.type ?? 'string',
      description: v.description ?? v.title ?? undefined,
    };
  }
  return {
    name: t.slug,
    description: (t.description || t.name).slice(0, 500),
    input_schema: { type: 'object', properties: props, required },
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch and store tool schemas for all providers connected to a mission.
 * Called at mission creation, when a connector is added, or when schemas are stale.
 * Fire-and-forget safe — errors are logged, not thrown.
 */
export async function refreshMissionTools(
  tenantId: string,
  missionId: string,
  connectedProviders: string[]
): Promise<void> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey || connectedProviders.length === 0) return;

  const supabase = createServiceClient();

  await Promise.allSettled(connectedProviders.map(async (provider) => {
    // Try Composio first
    const appSlug = AF_TO_COMPOSIO_APP[provider] ?? provider;
    const composioTools = await fetchComposioTools(appSlug, apiKey);

    let tools: AnthropicTool[];
    let logoUrl: string;

    if (composioTools.length > 0) {
      tools = composioTools.slice(0, MAX_TOOLS_PER_PROVIDER).map(composioToolToAnthropic);
      logoUrl = `${LOGO_CDN}/${appSlug}`;
    } else if (HARDCODED_PROVIDER_TOOLS[provider]) {
      // Fallback to hardcoded schemas for API-key-only providers
      tools = HARDCODED_PROVIDER_TOOLS[provider];
      logoUrl = HARDCODED_LOGO_OVERRIDES[provider] ?? `${LOGO_CDN}/${provider}`;
    } else {
      return; // No tools for this provider
    }

    const rows = tools.map(t => ({
      tenant_id: tenantId,
      mission_id: missionId,
      provider_slug: appSlug,
      action_name: t.name,
      display_name: actionNameToDisplay(t.name),
      description: t.description,
      parameters_schema: t.input_schema,
      logo_url: logoUrl,
      fetched_at: new Date().toISOString(),
      is_active: true,
    }));

    const { error } = await supabase
      .from('mission_tool_schemas')
      .upsert(rows, { onConflict: 'tenant_id,mission_id,action_name' });

    if (error) console.error(`[tool-registry] Upsert error for ${provider}:`, error);
    else console.log(`[tool-registry] Stored ${rows.length} tools for ${provider} (${appSlug}) mission=${missionId}`);
  }));
}

/**
 * Load tool schemas for a mission chat session.
 * Returns Anthropic tool definitions + metadata map for enriching tool_status events.
 * Also includes always-present system tools.
 *
 * If no schemas exist in DB (new mission), triggers a background refresh
 * and returns only system tools for this call.
 */
export async function loadMissionTools(
  tenantId: string,
  missionId: string,
  connectedProviders: string[]
): Promise<{ tools: AnthropicTool[]; toolMeta: Map<string, ToolMeta>; needsRefresh: boolean }> {
  const supabase = createServiceClient();
  const staleThreshold = new Date(Date.now() - STALENESS_HOURS * 3_600_000).toISOString();

  const { data: rows } = await supabase
    .from('mission_tool_schemas')
    .select('action_name, provider_slug, display_name, description, parameters_schema, logo_url, fetched_at')
    .eq('tenant_id', tenantId)
    .eq('mission_id', missionId)
    .eq('is_active', true)
    .order('provider_slug')
    .order('action_name')
    .limit(80);

  const freshRows = (rows ?? []).filter(r => r.fetched_at > staleThreshold);
  const needsRefresh = freshRows.length === 0;

  const dynamicTools: AnthropicTool[] = freshRows.map(r => ({
    name: r.action_name,
    description: r.description,
    input_schema: (r.parameters_schema as AnthropicTool['input_schema']) ?? {
      type: 'object',
      properties: {},
    },
  }));

  const toolMeta = new Map<string, ToolMeta>();
  for (const t of SYSTEM_TOOL_META) toolMeta.set(t.actionName, t);
  for (const r of freshRows) {
    toolMeta.set(r.action_name, {
      actionName: r.action_name,
      providerSlug: r.provider_slug,
      displayName: r.display_name,
      logoUrl: r.logo_url,
    });
  }

  // If stale/empty, add the legacy generic tool as fallback so the LLM can still act
  const fallbackTool: AnthropicTool = {
    name: 'execute_composio_action',
    description:
      'Execute a real action on a connected service. Use the exact Composio action slug (e.g. GOOGLECALENDAR_CREATE_EVENT, GMAIL_SEND_EMAIL, SLACK_SEND_MESSAGE). Only use providers the user has connected.',
    input_schema: {
      type: 'object',
      properties: {
        action_slug: { type: 'string', description: 'Exact Composio action slug in ALL_CAPS_UNDERSCORES format' },
        arguments: { type: 'object' as unknown as string, description: 'Arguments for the action' },
      },
      required: ['action_slug', 'arguments'],
    },
  };
  toolMeta.set('execute_composio_action', {
    actionName: 'execute_composio_action',
    providerSlug: 'composio',
    displayName: 'Running action',
    logoUrl: null,
  });

  const tools: AnthropicTool[] = [
    ...SYSTEM_TOOLS,
    ...(dynamicTools.length > 0 ? dynamicTools : [fallbackTool]),
  ];

  return { tools, toolMeta, needsRefresh };
}

/**
 * Execute a tool call — routes to the right backend.
 * Returns { content, summary } consumed by the chat loop.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  tenantId: string,
  missionId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ content: string; summary: string }> {

  // ── System tool: get_run_errors ────────────────────────────────────────
  if (name === 'get_run_errors') {
    const { data: latestRun } = await supabase
      .from('mission_runs')
      .select('id, run_number, status, started_at, agents_failed, agents_done, agents_total, summary')
      .eq('mission_id', missionId)
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRun) return { content: 'No runs found for this mission yet.', summary: 'No runs found' };

    const { data: errorEvents } = await supabase
      .from('events')
      .select('event_type, payload, created_at')
      .eq('run_id', latestRun.id)
      .eq('tenant_id', tenantId)
      .in('event_type', ['mission.failed', 'agent.failed', 'agent.error', 'circuit_breaker.triggered'])
      .order('created_at', { ascending: true });

    const runMeta = `Run #${latestRun.run_number} — ${latestRun.status}, started: ${latestRun.started_at}\nAgents: ${latestRun.agents_done ?? 0} done, ${latestRun.agents_failed ?? 0} failed of ${latestRun.agents_total ?? 0}`;
    const errors = (errorEvents ?? [])
      .map(e => `[${e.event_type}] ${e.payload?.error ?? e.payload?.message ?? e.payload?.reason ?? JSON.stringify(e.payload ?? {})}`)
      .join('\n');

    return {
      content: [runMeta, errors ? `\nErrors:\n${errors}` : '\n(No specific error events found)', latestRun.summary ? `\nSummary: ${latestRun.summary}` : ''].join(''),
      summary: `${errorEvents?.length ?? 0} error(s) in Run #${latestRun.run_number}`,
    };
  }

  // ── Legacy generic action (fallback when schemas not yet loaded) ───────
  if (name === 'execute_composio_action') {
    return executeComposioAction(input.action_slug as string, (input.arguments ?? {}) as Record<string, unknown>, tenantId);
  }

  // ── Hardcoded API-key tools ────────────────────────────────────────────
  if (name === 'TAVILY_SEARCH_WEB') {
    return executeTavilySearch(input, tenantId, supabase);
  }

  // ── Composio action (specific named tools from registry) ──────────────
  // All other tool names are Composio action slugs (ALL_CAPS_UNDERSCORES)
  if (/^[A-Z][A-Z0-9_]+$/.test(name)) {
    return executeComposioAction(name, input, tenantId);
  }

  return { content: `Unknown tool: ${name}`, summary: 'Unknown tool' };
}

async function executeComposioAction(
  actionSlug: string,
  args: Record<string, unknown>,
  tenantId: string
): Promise<{ content: string; summary: string }> {
  if (!actionSlug) return { content: 'Missing action slug.', summary: 'Invalid call' };

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return { content: 'Composio not configured.', summary: 'Not configured' };

  try {
    const { default: Composio } = await import('@composio/client');
    const client = new Composio({ apiKey });

    const result = await (client.tools as unknown as Record<string, (slug: string, opts: unknown) => Promise<unknown>>).execute(
      actionSlug,
      { user_id: tenantId, arguments: args }
    );

    const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    const truncated = resultStr.length > 4000 ? resultStr.slice(0, 4000) + '\n…(truncated)' : resultStr;

    return {
      content: `Action "${actionSlug}" completed.\n\nResult:\n${truncated}`,
      summary: summariseComposioResult(actionSlug, result),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Action "${actionSlug}" failed: ${msg}`, summary: `${actionSlug} failed` };
  }
}

async function executeTavilySearch(
  input: Record<string, unknown>,
  tenantId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ content: string; summary: string }> {
  const query = input.query as string;
  if (!query) return { content: 'No search query provided.', summary: 'Missing query' };

  // Prefer Tavily key from tenant_permissions, fall back to env
  let apiKey = process.env.TAVILY_API_KEY ?? '';
  try {
    const { data } = await supabase
      .from('tenant_permissions')
      .select('access_token')
      .eq('tenant_id', tenantId)
      .eq('provider', 'tavily')
      .maybeSingle();
    if (data?.access_token && data.access_token !== 'composio_managed') {
      apiKey = data.access_token;
    }
  } catch { /* use env key */ }

  if (!apiKey) return { content: 'Tavily search key not configured.', summary: 'Not configured' };

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ query, max_results: (input.max_results as number) ?? 5, search_depth: 'basic' }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json() as { results?: Array<{ title: string; content: string; url: string }> };
    const results = (data.results ?? []).slice(0, 5);
    const formatted = results.map(r => `[${r.title}]\n${r.content.slice(0, 300)}\n${r.url}`).join('\n\n');
    return {
      content: formatted || 'No results found.',
      summary: `Found ${results.length} results for "${query}"`,
    };
  } catch (err) {
    return { content: `Search failed: ${err instanceof Error ? err.message : String(err)}`, summary: 'Search failed' };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convert "GMAIL_SEND_EMAIL" → "Send Email" */
function actionNameToDisplay(slug: string): string {
  const parts = slug.split('_');
  // Skip the provider prefix (first word) and title-case the rest
  if (parts.length > 2) {
    return parts.slice(1).map(p => p.charAt(0) + p.slice(1).toLowerCase()).join(' ');
  }
  return parts.map(p => p.charAt(0) + p.slice(1).toLowerCase()).join(' ');
}

/** Generate a human-readable in-progress label from tool name + args. */
export function describeToolCall(actionName: string, args: Record<string, unknown>): string {
  const lc = actionName.toLowerCase();
  const to = String(args.to ?? args.recipient ?? args.email ?? '').trim();
  const subject = String(args.subject ?? args.title ?? args.name ?? args.summary ?? '').trim();
  const channel = String(args.channel ?? args.channel_name ?? '').trim();
  const query = String(args.query ?? '').trim();
  const calendar = String(args.calendar_id ?? '').trim();

  if (lc.includes('send') && to) return `Sending to ${to}…`;
  if (lc.includes('send') && channel) return `Posting to #${channel}…`;
  if ((lc.includes('create') || lc.includes('add')) && subject) return `Creating "${subject}"…`;
  if (lc.includes('search') && query) return `Searching "${query}"…`;
  if (lc.includes('list') || lc.includes('get') || lc.includes('fetch')) {
    const obj = actionName.split('_').slice(2).map(p => p.toLowerCase()).join(' ');
    return `Fetching ${obj || 'data'}…`;
  }
  if (lc.includes('update') && subject) return `Updating "${subject}"…`;
  if (lc.includes('delete') || lc.includes('remove')) return `Removing…`;
  if (lc.includes('book') || lc.includes('schedule')) return `Scheduling event…`;
  if (calendar) return `Checking calendar…`;
  return `Running ${actionNameToDisplay(actionName).toLowerCase()}…`;
}

/** Produce a short summary from a Composio result. */
function summariseComposioResult(actionSlug: string, result: unknown): string {
  const lc = actionSlug.toLowerCase();
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    if (r.id || r.event_id || r.messageId) {
      const id = r.id ?? r.event_id ?? r.messageId;
      if (lc.includes('create') || lc.includes('add') || lc.includes('insert')) return `Created — ID ${id}`;
      if (lc.includes('send')) return `Sent successfully`;
      if (lc.includes('update')) return `Updated — ID ${id}`;
    }
    if (Array.isArray(result)) return `Retrieved ${result.length} item${result.length !== 1 ? 's' : ''}`;
    if (r.items && Array.isArray(r.items)) return `Retrieved ${r.items.length} item${r.items.length !== 1 ? 's' : ''}`;
    if (r.success === true || r.status === 'ok' || r.status === 'success') return 'Completed successfully';
  }
  const slug = actionSlug.split('_').slice(1).map(p => p.charAt(0) + p.slice(1).toLowerCase()).join(' ');
  return `${slug} done`;
}
