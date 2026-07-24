import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// ============================================================
// Webhook Management API — /api/webhooks/manage
//
// GET  ?missionId=xxx         — list all webhooks for a mission
// POST { missionId, label }   — create a new webhook URL
// DELETE ?id=xxx              — delete a webhook
//
// All operations are scoped to the authenticated tenant via RLS.
// ============================================================

async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const missionId = req.nextUrl.searchParams.get('missionId');
  if (!missionId) return NextResponse.json({ error: 'missionId required' }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('mission_webhooks')
    .select('id, label, created_at, last_triggered_at, trigger_count')
    .eq('tenant_id', user.id)
    .eq('mission_id', missionId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Build full trigger URLs and omit the secret (only shown at creation time)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://agenticfactor.io';
  const webhooks = (data ?? []).map((w) => ({
    ...w,
    triggerUrl: `${baseUrl}/api/webhooks/trigger/${w.id}`,
  }));

  return NextResponse.json({ webhooks });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { missionId, label } = body as { missionId?: string; label?: string };
  if (!missionId) return NextResponse.json({ error: 'missionId required' }, { status: 400 });

  // Confirm the mission belongs to this tenant
  const supabase = createServiceClient();
  const { data: mission } = await supabase
    .from('missions')
    .select('id')
    .eq('id', missionId)
    .eq('tenant_id', user.id)
    .single();

  if (!mission) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

  const { data: webhook, error } = await supabase
    .from('mission_webhooks')
    .insert({
      tenant_id: user.id,
      mission_id: missionId,
      label: label ?? null,
    })
    .select('id, webhook_secret, label, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://agenticfactor.io';

  // Return the secret ONCE — it is never shown again after this response.
  return NextResponse.json({
    id: webhook.id,
    label: webhook.label,
    triggerUrl: `${baseUrl}/api/webhooks/trigger/${webhook.id}`,
    secret: webhook.webhook_secret,
    createdAt: webhook.created_at,
    note: 'Save the secret now — it will not be shown again.',
  }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('mission_webhooks')
    .delete()
    .eq('id', id)
    .eq('tenant_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
