import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { loadLiveRun } from '@/lib/services/run-live';

// ============================================================
// GET /api/missions/:id/live[?runId=]
// The live state of the mission's latest run (or the given one):
// run status, each agent's step, any approval it waits on, and
// whether it is a rehearsal. Polled by the run card and strip.
// ============================================================

export const maxDuration = 15;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;
  const runId = request.nextUrl.searchParams.get('runId');

  try {
    const view = await loadLiveRun(tenantId, missionId, runId);
    if (!view) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error(`[GET /api/missions/${missionId}/live] Error:`, error);
    return NextResponse.json({ error: 'Could not load the run' }, { status: 500 });
  }
}
