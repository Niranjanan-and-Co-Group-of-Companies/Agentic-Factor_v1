import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';

// ============================================================
// POST /api/v1/trigger/:missionId
//
// Customer-facing trigger API. Allows external apps, Zapier,
// Make, or custom code to trigger a mission via HTTP.
//
// Auth: API key in Authorization header as "Bearer <api_key>"
//       or X-API-Key header.
//
// The api_key is stored in tenant_permissions WHERE provider = 'customer_api_key'
// and scopes contains 'trigger'.
//
// Body (optional): { payload: any } — passed to mission as trigger context
// ============================================================

export const maxDuration = 15;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ missionId: string }> }
) {
  const { missionId } = await context.params;

  // Extract API key from Authorization header or X-API-Key
  const authHeader = request.headers.get('authorization') ?? '';
  const xApiKey = request.headers.get('x-api-key') ?? '';
  const apiKey = xApiKey || authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!apiKey) {
    return NextResponse.json({ error: 'Missing API key. Pass it in X-API-Key header or Authorization: Bearer <key>.' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Look up the API key in tenant_permissions
  const { data: keyRecord } = await supabase
    .from('tenant_permissions')
    .select('tenant_id, scopes')
    .eq('provider', 'customer_api_key')
    .eq('access_token', apiKey)
    .single();

  if (!keyRecord) {
    return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 });
  }

  const scopes: string[] = keyRecord.scopes ?? [];
  if (!scopes.includes('trigger') && !scopes.includes('*')) {
    return NextResponse.json({ error: 'API key does not have trigger permission.' }, { status: 403 });
  }

  const tenantId = keyRecord.tenant_id;

  // Verify mission belongs to this tenant
  const { data: mission } = await supabase
    .from('missions')
    .select('id, title, status')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  if (!mission) {
    return NextResponse.json({ error: 'Mission not found.' }, { status: 404 });
  }

  if (!['active', 'paused'].includes(mission.status)) {
    return NextResponse.json({ error: `Mission is in status "${mission.status}" and cannot be triggered.` }, { status: 409 });
  }

  // Parse optional payload
  let payload: unknown = {};
  try {
    const body = await request.json();
    if (body?.payload) payload = body.payload;
  } catch { /* no body is fine */ }

  // Create a run record
  const { data: runRow } = await supabase
    .from('mission_runs')
    .insert({
      tenant_id: tenantId,
      mission_id: missionId,
      trigger: 'api',
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  // Fire the Inngest event to execute the mission
  await inngest.send({
    name: 'mission/trigger',
    data: { missionId, tenantId, trigger: 'api', runId: runRow?.id, payload },
  });

  return NextResponse.json({
    ok: true,
    run_id: runRow?.id,
    mission_id: missionId,
    mission_title: mission.title,
    triggered_at: new Date().toISOString(),
  }, { status: 202 });
}

// GET /api/v1/trigger/:missionId — returns mission info for verification
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ missionId: string }> }
) {
  const { missionId } = await context.params;
  const authHeader = request.headers.get('authorization') ?? '';
  const xApiKey = request.headers.get('x-api-key') ?? '';
  const apiKey = xApiKey || authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!apiKey) return NextResponse.json({ error: 'Missing API key.' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: keyRecord } = await supabase
    .from('tenant_permissions')
    .select('tenant_id')
    .eq('provider', 'customer_api_key')
    .eq('access_token', apiKey)
    .single();
  if (!keyRecord) return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 });

  const { data: mission } = await supabase
    .from('missions')
    .select('id, title, status, created_at')
    .eq('id', missionId)
    .eq('tenant_id', keyRecord.tenant_id)
    .single();
  if (!mission) return NextResponse.json({ error: 'Mission not found.' }, { status: 404 });

  return NextResponse.json({ mission });
}
