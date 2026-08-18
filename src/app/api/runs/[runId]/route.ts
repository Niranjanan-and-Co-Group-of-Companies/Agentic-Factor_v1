import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// GET /api/runs/[runId] — look up a run by its ID to find its mission_id
// Used by the run detail page when sessionStorage doesn't have the mission mapping
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { runId } = await context.params;
  const supabase = createServiceClient();

  const { data: run, error } = await supabase
    .from('mission_runs')
    .select('id, mission_id, run_number, status, started_at, trigger_type')
    .eq('id', runId)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  return NextResponse.json({ missionId: run.mission_id, runNumber: run.run_number });
}
