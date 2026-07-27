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
  context: { params: Promise<{ webhookId: string }> }
) {
  const { webhookId } = await context.params;
  const supabase = createServiceClient();

  // Validate secret
  const secret = req.headers.get('x-webhook-secret');
  if (!secret) {
    return NextResponse.json({ error: 'Missing x-webhook-secret header' }, { status: 401 });
  }

  // Look up webhook record
  const { data: webhook, error: lookupErr } = await supabase
    .from('mission_webhooks')
    .select('id, tenant_id, mission_id, webhook_secret, trigger_count, filter_conditions')
    .eq('id', webhookId)
    .single();

  if (lookupErr || !webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
  }

  if (webhook.webhook_secret !== secret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  // Parse request body — accept any JSON payload
  let webhookPayload: Record<string, unknown> = {};
  try {
    webhookPayload = await req.json();
  } catch {
    // Non-JSON body is fine — pass empty object
  }

  // Evaluate filter_conditions if set — skip trigger if payload doesn't match
  const conditions = webhook.filter_conditions as Array<{ field: string; operator: string; value: unknown }> | null;
  if (conditions?.length) {
    const matched = conditions.every(({ field, operator, value }) => {
      const actual = field.split('.').reduce<unknown>((obj, key) => (obj as Record<string, unknown>)?.[key], webhookPayload);
      switch (operator) {
        case 'eq':  return actual === value;
        case 'neq': return actual !== value;
        case 'gt':  return (actual as number) > (value as number);
        case 'lt':  return (actual as number) < (value as number);
        case 'contains': return String(actual ?? '').includes(String(value));
        case 'exists':   return actual !== undefined && actual !== null;
        default: return true;
      }
    });
    if (!matched) {
      return NextResponse.json({ skipped: true, reason: 'filter_conditions not matched' }, { status: 200 });
    }
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
  context: { params: Promise<{ webhookId: string }> }
) {
  const { webhookId } = await context.params;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('mission_webhooks')
    .select('id, mission_id, label')
    .eq('id', webhookId)
    .single();

  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, missionId: data.mission_id, label: data.label });
}
