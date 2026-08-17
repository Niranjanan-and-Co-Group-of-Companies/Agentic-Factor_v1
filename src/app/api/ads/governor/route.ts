/**
 * Autonomous Paid Ads Budget Governor
 *
 * Called daily by the cron scheduler for any mission with type=paid_ads.
 * Reads live campaign stats from connected ad platforms via dynamic Composio
 * action discovery — no hardcoded action names. Discovers available toolkit
 * actions at runtime, selects the best stats action, executes it, and uses
 * the LLM to interpret the response into standard metrics.
 *
 * Decision logic:
 *   - CONTINUE: performance is acceptable, budget remaining
 *   - PAUSE:    budget exhausted or performance too poor for too long
 *   - REWRITE:  poor performance for N days → generate new ad copy
 *   - RELAUNCH: after rewrite, create new campaigns with better copy
 *
 * State is stored as an event row with event_type='ads.governor.state'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';

export const maxDuration = 60;

// ── Thresholds ──────────────────────────────────────────────
const POOR_CTR_THRESHOLD = 0.005;
const POOR_ROAS_THRESHOLD = 1.0;
const MAX_POOR_DAYS_BEFORE_REWRITE = 3;
const MIN_SPEND_FOR_JUDGEMENT = 500;

const COMPOSIO_API_BASE = 'https://backend.composio.dev';

// Keywords that identify campaign-stats actions in any toolkit
const STATS_KEYWORDS = ['stat', 'insight', 'metric', 'report', 'spend', 'performance', 'analytic'];

export interface AdsGovernorState {
  missionId: string;
  tenantId: string;
  totalBudget: number;
  currency: string;
  cumulativeSpend: number;
  consecutivePoorDays: number;
  lastCheckAt: string;
  campaignIds: {
    google?: string[];
    meta?: string[];
  };
  history: Array<{
    date: string;
    googleSpend: number;
    metaSpend: number;
    googleCtr: number;
    metaCtr: number;
    googleRoas: number | null;
    metaRoas: number | null;
    decision: 'continue' | 'warning' | 'pause' | 'rewrite' | 'relaunch';
  }>;
  status: 'active' | 'paused' | 'rewriting' | 'relaunching' | 'completed';
  rewriteCount: number;
}

// ── GET — read current state ─────────────────────────────────
export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const missionId = request.nextUrl.searchParams.get('missionId');
  if (!missionId) return NextResponse.json({ error: 'missionId required' }, { status: 400 });

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('events')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('entity_id', missionId)
    .eq('event_type', 'ads.governor.state')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return NextResponse.json({ state: null });
  return NextResponse.json({ state: data.payload as AdsGovernorState });
}

// ── POST — initialize governor for a new paid ads mission ───
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const body = await request.json() as {
    missionId: string;
    totalBudget: number;
    currency?: string;
    campaignIds?: { google?: string[]; meta?: string[] };
  };

  if (!body.missionId || !body.totalBudget) {
    return NextResponse.json({ error: 'missionId and totalBudget required' }, { status: 400 });
  }

  const state: AdsGovernorState = {
    missionId: body.missionId,
    tenantId,
    totalBudget: body.totalBudget,
    currency: body.currency ?? 'INR',
    cumulativeSpend: 0,
    consecutivePoorDays: 0,
    lastCheckAt: new Date().toISOString(),
    campaignIds: body.campaignIds ?? {},
    history: [],
    status: 'active',
    rewriteCount: 0,
  };

  const supabase = createServiceClient();
  await supabase.from('events').upsert({
    tenant_id: tenantId,
    event_type: 'ads.governor.state',
    entity_type: 'mission',
    entity_id: body.missionId,
    payload: state,
  }, { onConflict: 'tenant_id,entity_id,event_type' });

  return NextResponse.json({ ok: true, state });
}

// ── PATCH — run the daily check ──────────────────────────────
export async function PATCH(request: NextRequest) {
  const internalTenantId = request.headers.get('x-tenant-id');
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const isCronCall = cronSecret && authHeader === `Bearer ${cronSecret}` && internalTenantId;

  let tenantId: string;
  if (isCronCall) {
    tenantId = internalTenantId;
  } else {
    const authResult = await extractTenantContext(request);
    if (isAuthError(authResult)) return authResult;
    tenantId = authResult.tenantId;
  }

  const body = await request.json() as { missionId: string };
  if (!body.missionId) return NextResponse.json({ error: 'missionId required' }, { status: 400 });

  const supabase = createServiceClient();

  const { data: stateRow } = await supabase
    .from('events')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('entity_id', body.missionId)
    .eq('event_type', 'ads.governor.state')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!stateRow) {
    return NextResponse.json({ error: 'Governor not initialized for this mission' }, { status: 404 });
  }

  const state = stateRow.payload as AdsGovernorState;
  if (state.status !== 'active') {
    return NextResponse.json({ decision: state.status, message: 'Governor is not active', state });
  }

  const stats = await fetchLiveCampaignStats(tenantId, state);
  const today = new Date().toISOString().split('T')[0];

  const totalDailySpend = stats.googleSpend + stats.metaSpend;
  state.cumulativeSpend += totalDailySpend;

  const isPoorPerformance =
    state.cumulativeSpend >= MIN_SPEND_FOR_JUDGEMENT &&
    stats.googleCtr < POOR_CTR_THRESHOLD &&
    stats.metaCtr < POOR_CTR_THRESHOLD &&
    (stats.googleRoas === null || stats.googleRoas < POOR_ROAS_THRESHOLD);

  const budgetExhausted = state.cumulativeSpend >= state.totalBudget;

  let decision: AdsGovernorState['history'][0]['decision'] = 'continue';

  if (budgetExhausted) {
    decision = 'pause';
    state.status = 'completed';
  } else if (isPoorPerformance) {
    state.consecutivePoorDays++;
    if (state.consecutivePoorDays >= MAX_POOR_DAYS_BEFORE_REWRITE) {
      if (state.rewriteCount >= 2) {
        decision = 'pause';
        state.status = 'paused';
      } else {
        decision = 'rewrite';
        state.status = 'rewriting';
        state.consecutivePoorDays = 0;
        state.rewriteCount++;
      }
    } else {
      decision = 'warning';
    }
  } else {
    state.consecutivePoorDays = 0;
  }

  state.history.push({
    date: today,
    googleSpend: stats.googleSpend,
    metaSpend: stats.metaSpend,
    googleCtr: stats.googleCtr,
    metaCtr: stats.metaCtr,
    googleRoas: stats.googleRoas,
    metaRoas: stats.metaRoas,
    decision,
  });
  state.lastCheckAt = new Date().toISOString();

  await supabase.from('events').upsert({
    tenant_id: tenantId,
    event_type: 'ads.governor.state',
    entity_type: 'mission',
    entity_id: body.missionId,
    payload: state,
  }, { onConflict: 'tenant_id,entity_id,event_type' });

  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'ads.governor.check',
    entity_type: 'mission',
    entity_id: body.missionId,
    payload: {
      date: today,
      decision,
      cumulativeSpend: state.cumulativeSpend,
      totalBudget: state.totalBudget,
      ...stats,
    },
  });

  if (decision === 'pause' || decision === 'rewrite') {
    await inngest.send({
      name: 'mission.execute',
      data: {
        missionId: body.missionId,
        tenantId,
        runId: crypto.randomUUID(),
        trigger: 'ads_governor',
        context: {
          governorDecision: decision,
          state,
          stats,
          instructions: decision === 'pause'
            ? `Budget governor has decided to PAUSE all campaigns. Cumulative spend: ${state.cumulativeSpend} ${state.currency} / budget: ${state.totalBudget} ${state.currency}. Pause all Google Ads and Meta campaigns listed in the governor state using the ad platform APIs.`
            : `Budget governor has decided to REWRITE ad copy after ${MAX_POOR_DAYS_BEFORE_REWRITE} consecutive poor-performance days. Average CTR: Google ${(stats.googleCtr * 100).toFixed(2)}%, Meta ${(stats.metaCtr * 100).toFixed(2)}%. Use the Expert Copywriter agent to generate 5 new ad variations with different angles. Then rebuild campaigns in PAUSED state with the new copy.`,
        },
      },
    }).catch((err: unknown) => {
      console.error('[AdsGovernor] Failed to fire Inngest:', err);
    });
  }

  return NextResponse.json({ decision, state, stats });
}

// ── Dynamic campaign stats fetching ──────────────────────────

interface ComposioActionSchema {
  slug: string;
  name: string;
  description: string;
  input_parameters?: {
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

interface CampaignStats {
  googleSpend: number;
  metaSpend: number;
  googleCtr: number;
  metaCtr: number;
  googleRoas: number | null;
  metaRoas: number | null;
  source: 'live' | 'unavailable';
  error?: string;
}

// 30-minute cache for toolkit action lists (same TTL as composio-actions.ts)
const governorActionCache = new Map<string, { actions: ComposioActionSchema[]; expiresAt: number }>();

async function fetchToolkitActions(toolkit: string, apiKey: string): Promise<ComposioActionSchema[]> {
  const cached = governorActionCache.get(toolkit);
  if (cached && cached.expiresAt > Date.now()) return cached.actions;

  const allActions: ComposioActionSchema[] = [];
  const PAGE_SIZE = 100;
  let offset = 0;

  try {
    while (true) {
      const url = `${COMPOSIO_API_BASE}/api/v3.1/tools?toolkit_slug=${toolkit}&limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await fetch(url, {
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn(`[AdsGovernor] ${toolkit} offset=${offset}: HTTP ${res.status}`);
        break;
      }
      const data = await res.json() as { items?: ComposioActionSchema[] };
      const items = data.items ?? [];
      allActions.push(...items);
      if (items.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (allActions.length >= 1000) break;
    }
  } catch (err) {
    console.warn(`[AdsGovernor] Error fetching ${toolkit} actions:`, err);
  }

  governorActionCache.set(toolkit, { actions: allActions, expiresAt: Date.now() + 30 * 60 * 1000 });
  console.log(`[AdsGovernor] Discovered ${allActions.length} actions for ${toolkit}`);
  return allActions;
}

/**
 * Pick the best campaign-stats action from a toolkit's action list.
 * Scores by keyword match in slug and description — no hardcoded names.
 */
function selectStatsAction(actions: ComposioActionSchema[]): ComposioActionSchema | null {
  const scored = actions
    .map(a => {
      const text = `${a.slug} ${a.description ?? ''}`.toLowerCase();
      const kwHits = STATS_KEYWORDS.filter(kw => text.includes(kw)).length;
      // Bonus for slug-level matches (more specific)
      const slugHits = STATS_KEYWORDS.filter(kw => a.slug.toLowerCase().includes(kw)).length;
      return { action: a, score: kwHits + slugHits * 2 };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.action ?? null;
}

/**
 * Build input parameters for any stats action using common parameter-name patterns.
 * Covers the parameter schemas used by Google Ads, Meta Ads, and most ad platforms.
 */
function buildActionParams(
  action: ComposioActionSchema,
  campaignIds: string[],
  dateRange: { start: string; end: string },
): Record<string, unknown> {
  const props = action.input_parameters?.properties ?? {};
  const required = action.input_parameters?.required ?? [];
  const params: Record<string, unknown> = {};

  for (const param of required) {
    const p = param.toLowerCase();
    if (p.includes('campaign_id') || p.includes('campaignid') || p.includes('campaign_ids')) {
      params[param] = campaignIds.length === 1 ? campaignIds[0] : campaignIds;
    } else if (p === 'start_date' || p === 'start' || p === 'from' || p === 'date_from') {
      params[param] = dateRange.start;
    } else if (p === 'end_date' || p === 'end' || p === 'until' || p === 'to' || p === 'date_to') {
      params[param] = dateRange.end;
    } else if (p.includes('date_range') || p.includes('daterange')) {
      params[param] = { start_date: dateRange.start, end_date: dateRange.end };
    } else if (p.includes('time_range') || p.includes('timerange')) {
      params[param] = { since: dateRange.start, until: dateRange.end };
    } else if ((p.includes('date') && !p.includes('start') && !p.includes('end'))) {
      params[param] = dateRange.start;
    } else if (p === 'fields' || p === 'metrics' || p === 'columns') {
      // Request the fields we care about — string or array depending on schema type
      const fieldList = ['spend', 'impressions', 'clicks', 'actions', 'action_values', 'cost_micros', 'conversions_value'];
      params[param] = props[param]?.type === 'string' ? fieldList.join(',') : fieldList;
    }
  }

  return params;
}

/**
 * Execute a Composio action via the REST API.
 * Uses the tenant's Composio entity (user_id = tenantId set at connection time).
 */
async function executeComposioAction(
  action: string,
  params: Record<string, unknown>,
  apiKey: string,
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${COMPOSIO_API_BASE}/api/v1/actions/${action}/execute`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectedAccountId: tenantId, input: params }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[AdsGovernor] Action ${action} returned HTTP ${res.status}`);
      return null;
    }
    const data = await res.json() as { data?: Record<string, unknown> };
    return data.data ?? null;
  } catch (err) {
    console.warn(`[AdsGovernor] Action ${action} failed:`, err);
    return null;
  }
}

/**
 * Use the LLM to extract spend/impressions/clicks/roas from any ad platform
 * API response — handles different field names across Google Ads, Meta, etc.
 */
async function interpretStatsWithLLM(
  platform: string,
  rawResponse: Record<string, unknown> | null,
  date: string,
): Promise<{ spend: number; impressions: number; clicks: number; roas: number | null } | null> {
  if (!rawResponse) return null;

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!geminiKey && !openaiKey) return null;

  const prompt = `You are extracting ad campaign performance metrics from a ${platform} API response for ${date}.

Raw response:
${JSON.stringify(rawResponse).slice(0, 3000)}

Return ONLY valid JSON with these four fields. Use 0 for missing numbers, null for uncomputable roas:
{"spend": <number>, "impressions": <number>, "clicks": <number>, "roas": <number|null>}

Notes:
- spend: total money spent (divide micros by 1,000,000 if needed)
- roas: conversions_value / spend (null if no conversion data)`;

  try {
    let text = '';

    if (geminiKey) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 200 },
          }),
          signal: AbortSignal.timeout(15_000),
        }
      );
      const data = await res.json() as { candidates?: Array<{ content: { parts: Array<{ text: string }> } }> };
      text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          max_tokens: 200,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
      text = data.choices?.[0]?.message?.content ?? '';
    }

    const parsed = JSON.parse(text) as { spend?: number; impressions?: number; clicks?: number; roas?: number | null };
    return {
      spend: Number(parsed.spend ?? 0),
      impressions: Number(parsed.impressions ?? 0),
      clicks: Number(parsed.clicks ?? 0),
      roas: parsed.roas != null ? Number(parsed.roas) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch live campaign performance stats from any connected ad platform.
 *
 * Fully dynamic: discovers available actions from the Composio toolkit at
 * runtime, selects the best stats action by keyword scoring, builds
 * parameters from the action's schema, executes it, and uses the LLM to
 * parse the raw response — no hardcoded action names or response fields.
 */
async function fetchLiveCampaignStats(
  tenantId: string,
  state: AdsGovernorState,
): Promise<CampaignStats> {
  const composioApiKey = process.env.COMPOSIO_API_KEY;

  if (!composioApiKey) {
    return { googleSpend: 0, metaSpend: 0, googleCtr: 0, metaCtr: 0, googleRoas: null, metaRoas: null, source: 'unavailable', error: 'COMPOSIO_API_KEY not configured' };
  }
  if (!state.campaignIds.google?.length && !state.campaignIds.meta?.length) {
    return { googleSpend: 0, metaSpend: 0, googleCtr: 0, metaCtr: 0, googleRoas: null, metaRoas: null, source: 'unavailable', error: 'No campaign IDs registered with governor' };
  }

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];

  // ── Google Ads ────────────────────────────────────────────────
  let googleSpend = 0;
  let googleCtr = 0;
  let googleRoas: number | null = null;

  if (state.campaignIds.google?.length) {
    const googleActions = await fetchToolkitActions('googleads', composioApiKey);
    const statsAction = selectStatsAction(googleActions);

    if (statsAction) {
      console.log(`[AdsGovernor] Google Ads → using action: ${statsAction.slug}`);
      const params = buildActionParams(statsAction, state.campaignIds.google, { start: yesterday, end: yesterday });
      const raw = await executeComposioAction(statsAction.slug, params, composioApiKey, tenantId);
      const stats = await interpretStatsWithLLM('Google Ads', raw, yesterday);
      if (stats) {
        googleSpend = stats.spend;
        googleCtr = stats.impressions > 0 ? stats.clicks / stats.impressions : 0;
        googleRoas = stats.roas;
      }
    } else {
      console.warn('[AdsGovernor] No stats action found in googleads toolkit');
    }
  }

  // ── Meta / Facebook Ads ───────────────────────────────────────
  let metaSpend = 0;
  let metaCtr = 0;
  let metaRoas: number | null = null;

  if (state.campaignIds.meta?.length) {
    const metaActions = await fetchToolkitActions('facebookads', composioApiKey);
    const statsAction = selectStatsAction(metaActions);

    if (statsAction) {
      console.log(`[AdsGovernor] Meta Ads → using action: ${statsAction.slug}`);
      const params = buildActionParams(statsAction, state.campaignIds.meta, { start: yesterday, end: yesterday });
      const raw = await executeComposioAction(statsAction.slug, params, composioApiKey, tenantId);
      const stats = await interpretStatsWithLLM('Meta Ads', raw, yesterday);
      if (stats) {
        metaSpend = stats.spend;
        metaCtr = stats.impressions > 0 ? stats.clicks / stats.impressions : 0;
        metaRoas = stats.roas;
      }
    } else {
      console.warn('[AdsGovernor] No stats action found in facebookads toolkit');
    }
  }

  return {
    googleSpend, metaSpend,
    googleCtr, metaCtr,
    googleRoas, metaRoas,
    source: 'live',
  };
}
