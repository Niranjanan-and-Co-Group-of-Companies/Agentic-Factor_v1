import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/runs/active
// Missions with a run in progress, for the running dots in the
// missions list. A paused run counts only while it waits on an
// approval (a credit pause is not "running").
// ============================================================

export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const supabase = createServiceClient();
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const [{ data: runs }, { data: pending }] = await Promise.all([
      supabase
        .from('mission_runs')
        .select('mission_id, status')
        .eq('tenant_id', tenantId)
        .in('status', ['queued', 'running', 'paused'])
        .gte('started_at', since)
        .limit(100),
      supabase
        .from('proposed_actions')
        .select('mission_id')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .limit(100),
    ]);
    const waiting = new Set((pending ?? []).map(p => p.mission_id));
    const active: Record<string, 'running' | 'approval'> = {};
    for (const r of runs ?? []) {
      if (r.status === 'paused') { if (waiting.has(r.mission_id)) active[r.mission_id] = 'approval'; }
      else if (active[r.mission_id] !== 'approval') active[r.mission_id] = 'running';
    }
    return NextResponse.json({ active }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[GET /api/runs/active] Error:', error);
    return NextResponse.json({ active: {} });
  }
}
