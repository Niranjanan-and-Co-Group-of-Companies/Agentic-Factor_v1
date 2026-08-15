/**
 * Autonomous Paid Ads Budget Governor
 *
 * Called daily by the cron scheduler for any mission with type=paid_ads.
 * Reads live campaign stats from connected ad platforms, updates cumulative
 * spend state in the events table, and decides:
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

export const maxDuration = 30;

// ── Thresholds ──────────────────────────────────────────────
const POOR_CTR_THRESHOLD = 0.005;       // <0.5% CTR is poor
const POOR_ROAS_THRESHOLD = 1.0;        // ROAS <1 means losing money
const MAX_POOR_DAYS_BEFORE_REWRITE = 3; // Rewrite after 3 consecutive bad days
const MIN_SPEND_FOR_JUDGEMENT = 500;    // Don't judge until ₹500+ spent

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
  // Support internal cron calls that pass x-tenant-id header
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

  // Load current governor state
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

  // Fetch live stats from ad platforms via Composio
  const stats = await fetchLiveCampaignStats(tenantId, state);
  const today = new Date().toISOString().split('T')[0];

  // Determine today's performance
  const totalDailySpend = stats.googleSpend + stats.metaSpend;
  state.cumulativeSpend += totalDailySpend;

  const isPoorPerformance =
    state.cumulativeSpend >= MIN_SPEND_FOR_JUDGEMENT &&
    stats.googleCtr < POOR_CTR_THRESHOLD &&
    stats.metaCtr < POOR_CTR_THRESHOLD &&
    (stats.googleRoas === null || stats.googleRoas < POOR_ROAS_THRESHOLD);

  // Budget exhaustion check
  const budgetExhausted = state.cumulativeSpend >= state.totalBudget;

  let decision: AdsGovernorState['history'][0]['decision'] = 'continue';

  if (budgetExhausted) {
    decision = 'pause';
    state.status = 'completed';
  } else if (isPoorPerformance) {
    state.consecutivePoorDays++;
    if (state.consecutivePoorDays >= MAX_POOR_DAYS_BEFORE_REWRITE) {
      if (state.rewriteCount >= 2) {
        // Already tried rewriting twice — pause and report
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

  // Persist updated state
  await supabase.from('events').upsert({
    tenant_id: tenantId,
    event_type: 'ads.governor.state',
    entity_type: 'mission',
    entity_id: body.missionId,
    payload: state,
  }, { onConflict: 'tenant_id,entity_id,event_type' });

  // Log the check as an audit event
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

  // Act on the decision
  if (decision === 'pause' || decision === 'rewrite') {
    // Fire a mission to pause campaigns via Composio + optionally trigger rewrite
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
      console.error('[Ads Governor] Failed to fire Inngest:', err);
    });
  }

  return NextResponse.json({ decision, state, stats });
}

// ── Helpers ──────────────────────────────────────────────────

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

async function fetchLiveCampaignStats(
  tenantId: string,
  state: AdsGovernorState,
): Promise<CampaignStats> {
  const composioApiKey = process.env.COMPOSIO_API_KEY;

  if (!composioApiKey || (!state.campaignIds.google?.length && !state.campaignIds.meta?.length)) {
    return {
      googleSpend: 0, metaSpend: 0,
      googleCtr: 0, metaCtr: 0,
      googleRoas: null, metaRoas: null,
      source: 'unavailable',
      error: 'No campaign IDs registered with governor or no Composio key',
    };
  }

  // Use Composio to fetch spend and performance stats
  const COMPOSIO_API_BASE = 'https://backend.composio.dev';

  async function executeComposioAction(
    action: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${COMPOSIO_API_BASE}/api/v1/actions/${action}/execute`, {
        method: 'POST',
        headers: { 'x-api-key': composioApiKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectedAccountId: tenantId, input: params }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { data?: Record<string, unknown> };
      return data.data ?? null;
    } catch {
      return null;
    }
  }

  let googleSpend = 0;
  let googleCtr = 0;
  let googleRoas: number | null = null;

  if (state.campaignIds.google?.length) {
    // GOOGLEADS_LIST_CAMPAIGN_STATS or similar — fetch yesterday's metrics
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
    const googleStats = await executeComposioAction('GOOGLEADS_GET_CAMPAIGN_STATS', {
      campaign_ids: state.campaignIds.google,
      date_range: { start_date: yesterday, end_date: yesterday },
    });

    if (googleStats) {
      googleSpend = Number(googleStats.cost_micros ?? 0) / 1_000_000;
      const impressions = Number(googleStats.impressions ?? 0);
      const clicks = Number(googleStats.clicks ?? 0);
      googleCtr = impressions > 0 ? clicks / impressions : 0;
      const conversionsValue = Number(googleStats.conversions_value ?? 0);
      googleRoas = googleSpend > 0 ? conversionsValue / googleSpend : null;
    }
  }

  let metaSpend = 0;
  let metaCtr = 0;
  let metaRoas: number | null = null;

  if (state.campaignIds.meta?.length) {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
    const metaStats = await executeComposioAction('FACEBOOKADS_GET_CAMPAIGN_INSIGHTS', {
      campaign_ids: state.campaignIds.meta,
      time_range: { since: yesterday, until: yesterday },
      fields: ['spend', 'impressions', 'clicks', 'actions', 'action_values'],
    });

    if (metaStats) {
      metaSpend = Number(metaStats.spend ?? 0);
      const impressions = Number(metaStats.impressions ?? 0);
      const clicks = Number(metaStats.clicks ?? 0);
      metaCtr = impressions > 0 ? clicks / impressions : 0;
      const purchaseValue = Number(metaStats.purchase_value ?? 0);
      metaRoas = metaSpend > 0 ? purchaseValue / metaSpend : null;
    }
  }

  return {
    googleSpend, metaSpend,
    googleCtr, metaCtr,
    googleRoas, metaRoas,
    source: 'live',
  };
}
