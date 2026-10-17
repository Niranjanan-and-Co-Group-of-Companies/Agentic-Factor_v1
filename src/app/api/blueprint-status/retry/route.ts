import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { jobRequest, recordJobStatus } from '@/lib/services/build-jobs';

export const maxDuration = 30;

/**
 * POST /api/blueprint-status/retry { jobId } — builds a failed mission again from the same request.
 * The Command Center message that started it follows the new job.
 */
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { jobId } = await request.json().catch(() => ({})) as { jobId?: unknown };
  if (typeof jobId !== 'string' || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 });
  }

  const { checkCredits } = await import('@/lib/middleware/billing');
  const credit = await checkCredits(tenantId, 1);
  if (!credit.allowed) return NextResponse.json({ error: credit.reason }, { status: 402 });

  const supabase = createServiceClient();
  const original = await jobRequest(supabase, tenantId, jobId);
  if (!original) {
    return NextResponse.json({ error: 'This build can’t be repeated automatically — describe the mission again.' }, { status: 404 });
  }

  const newJobId = crypto.randomUUID();
  await recordJobStatus(supabase, tenantId, newJobId, 'pending', { step: 'Queued…', request: original, retryOf: jobId });
  const { inngest } = await import('@/lib/inngest/client');
  await inngest.send({ name: 'mission/blueprint.generate', data: { jobId: newJobId, tenantId, ...original } });
  await supabase.from('mission_chat_messages')
    .update({ action_payload: { type: 'building_blueprint', jobId: newJobId } })
    .eq('tenant_id', tenantId)
    .eq('action_payload->>jobId', jobId);

  return NextResponse.json({ jobId: newJobId });
}
