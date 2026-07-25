import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 15;

// GET /api/billing/usage
// Returns billing summary + run history for the usage analytics dashboard.
export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const supabase = createServiceClient();

  const [billingRes, missionsRes, runsRes] = await Promise.all([
    supabase
      .from('tenant_billing')
      .select('plan, credits_remaining, credits_total, credits_used_this_month, billing_period_start, billing_period_end, monthly_credit_limit, billing_status, is_trial')
      .eq('tenant_id', tenantId)
      .single(),

    supabase
      .from('missions')
      .select('id, status, created_at')
      .eq('tenant_id', tenantId),

    // Last 60 days of runs for the chart
    supabase
      .from('mission_runs')
      .select('id, mission_id, status, trigger, started_at, duration_ms, agents_total, agents_done, agents_failed')
      .eq('tenant_id', tenantId)
      .gte('started_at', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString())
      .order('started_at', { ascending: false })
      .limit(500),
  ]);

  const billing = billingRes.data;
  const missions = missionsRes.data ?? [];
  const runs = runsRes.data ?? [];

  // ── Daily run counts for chart (last 30 days) ──
  const dailyCounts: Record<string, { completed: number; failed: number; total: number }> = {};
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  for (const run of runs) {
    const ts = new Date(run.started_at).getTime();
    if (ts < thirtyDaysAgo) continue;
    const day = run.started_at.slice(0, 10); // YYYY-MM-DD
    if (!dailyCounts[day]) dailyCounts[day] = { completed: 0, failed: 0, total: 0 };
    dailyCounts[day].total++;
    if (run.status === 'completed') dailyCounts[day].completed++;
    if (run.status === 'failed') dailyCounts[day].failed++;
  }

  // ── Per-mission stats ──
  const missionStats: Record<string, { title: string; runCount: number; lastRun: string | null }> = {};
  const missionIds = [...new Set(runs.map(r => r.mission_id))];

  if (missionIds.length > 0) {
    const { data: missionTitles } = await supabase
      .from('missions')
      .select('id, title')
      .in('id', missionIds);

    for (const m of missionTitles ?? []) {
      missionStats[m.id] = { title: m.title, runCount: 0, lastRun: null };
    }
    for (const run of runs) {
      if (missionStats[run.mission_id]) {
        missionStats[run.mission_id].runCount++;
        if (!missionStats[run.mission_id].lastRun) {
          missionStats[run.mission_id].lastRun = run.started_at;
        }
      }
    }
  }

  // Top 5 missions by run count
  const topMissions = Object.entries(missionStats)
    .sort((a, b) => b[1].runCount - a[1].runCount)
    .slice(0, 5)
    .map(([id, stats]) => ({ id, ...stats }));

  // ── Trigger breakdown ──
  const triggerCounts = runs.reduce<Record<string, number>>((acc, r) => {
    const t = r.trigger || 'manual';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    billing: billing ?? null,
    missions: {
      total: missions.length,
      byStatus: missions.reduce<Record<string, number>>((acc, m) => {
        acc[m.status] = (acc[m.status] || 0) + 1;
        return acc;
      }, {}),
    },
    runs: {
      total: runs.length,
      completed: runs.filter(r => r.status === 'completed').length,
      failed: runs.filter(r => r.status === 'failed').length,
      byDay: dailyCounts,
      byTrigger: triggerCounts,
    },
    topMissions,
  });
}

// PATCH /api/billing/usage — update monthly_credit_limit (spending cap)
export async function PATCH(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { monthly_credit_limit } = await request.json() as { monthly_credit_limit: number | null };

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('tenant_billing')
    .update({ monthly_credit_limit })
    .eq('tenant_id', tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
