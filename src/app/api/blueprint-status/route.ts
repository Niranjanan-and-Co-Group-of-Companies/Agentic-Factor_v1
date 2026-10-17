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

  // The latest status update Inngest wrote for this job, with how far the code steps have got.
  const { data: events } = await supabase
    .from('events')
    .select('payload, created_at')
    .eq('tenant_id', tenantId)
    .eq('event_type', 'blueprint.job_update')
    .eq('entity_id', jobId)
    .order('created_at', { ascending: false })
    .limit(80);

  if (!events || events.length === 0) {
    return new Response(JSON.stringify({ status: 'pending', step: 'Queuing...' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  type JobPayload = { status?: string; request?: unknown; codeRoles?: string[]; codeReady?: string; [k: string]: unknown };
  const payloads = events.map(e => e.payload as JobPayload);
  // The request is kept for "Try again"; the browser doesn't need it back.
  const latest = { ...payloads[0] };
  delete latest.request;
  delete latest.codeRoles;
  delete latest.codeReady;
  const codeRoles = payloads.find(p => Array.isArray(p.codeRoles))?.codeRoles;
  const progress = codeRoles?.length
    ? { roles: codeRoles, ready: [...new Set(payloads.map(p => p.codeReady).filter((r): r is string => typeof r === 'string'))] }
    : undefined;

  return new Response(JSON.stringify({ ...latest, ...(progress ? { progress } : {}) }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
