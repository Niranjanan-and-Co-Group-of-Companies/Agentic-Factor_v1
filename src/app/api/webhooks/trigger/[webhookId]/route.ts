import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';

// ============================================================
// Webhook Trigger — POST /api/webhooks/trigger/[webhookId]
//
// Any external system (Google Sheets, Typeform, HubSpot, etc.)
// can POST here to run a mission on demand. The full request
// body is passed into the mission as webhookPayload so agents
// can use the incoming data (new row, form submission, etc.).
//
// Authentication: x-webhook-secret header must match the secret
// stored in mission_webhooks. The secret is auto-generated on
// creation and only visible once to the user.
// ============================================================

export async function POST(
  req: NextRequest,
  { params }: { params: { webhookId: string } }
) {
  const supabase = createServiceClient();
  const { webhookId } = params;

  // Validate secret
  const secret = req.headers.get('x-webhook-secret');
  if (!secret) {
    return NextResponse.json({ error: 'Missing x-webhook-secret header' }, { status: 401 });
  }

  // Look up webhook record
  const { data: webhook, error: lookupErr } = await supabase
    .from('mission_webhooks')
    .select('id, tenant_id, mission_id, webhook_secret, trigger_count')
    .eq('id', webhookId)
    .single();

  if (lookupErr || !webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
  }

  if (webhook.webhook_secret !== secret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  // Parse request body — accept any JSON payload
  let webhookPayload: unknown = {};
  try {
    webhookPayload = await req.json();
  } catch {
    // Non-JSON body is fine — pass empty object
  }

  // Generate a runId here so the caller can track this specific execution
  const runId = crypto.randomUUID();

  // Fire Inngest — mission runs in background, this response returns immediately
  await inngest.send({
    name: 'mission.execute',
    data: {
      missionId: webhook.mission_id,
      tenantId: webhook.tenant_id,
      runId,
      trigger: 'webhook',
      webhookPayload,
    },
  });

  // Update usage stats on the webhook record
  await supabase
    .from('mission_webhooks')
    .update({
      last_triggered_at: new Date().toISOString(),
      trigger_count: webhook.trigger_count + 1,
    })
    .eq('id', webhookId);

  return NextResponse.json({ success: true, runId }, { status: 202 });
}

// Health-check for webhook URL validation
export async function GET(
  _req: NextRequest,
  { params }: { params: { webhookId: string } }
) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('mission_webhooks')
    .select('id, mission_id, label')
    .eq('id', params.webhookId)
    .single();

  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, missionId: data.mission_id, label: data.label });
}
