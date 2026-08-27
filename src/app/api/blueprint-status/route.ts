import { NextRequest } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return new Response(JSON.stringify({ error: 'jobId required' }), { status: 400 });
  }

  const supabase = createServiceClient();

  // Return the latest status update Inngest wrote for this job
  const { data: events } = await supabase
    .from('events')
    .select('payload, created_at')
    .eq('tenant_id', tenantId)
    .eq('event_type', 'blueprint.job_update')
    .eq('entity_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!events || events.length === 0) {
    return new Response(JSON.stringify({ status: 'pending', step: 'Queuing...' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(events[0].payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}
