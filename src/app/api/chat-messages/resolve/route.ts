import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';

// ============================================================
// POST /api/chat-messages/resolve { messageId, outcome }
// Marks an assistant's action card as used — applied or skipped —
// so it stays that way after a reload, in the mission chat and in
// the Command Center.
// ============================================================

const Body = z.object({
  messageId: z.string().uuid(),
  outcome: z.enum(['applied', 'skipped']),
});

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  const { messageId, outcome } = parsed.data;

  const supabase = createServiceClient();
  const { data: msg } = await supabase
    .from('mission_chat_messages')
    .select('id, action_payload')
    .eq('id', messageId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!msg) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!msg.action_payload) return NextResponse.json({ ok: true });

  const payload = { ...(msg.action_payload as Record<string, unknown>), resolved: outcome, resolvedAt: new Date().toISOString() };
  const { error } = await supabase
    .from('mission_chat_messages')
    .update({ action_applied: true, action_payload: payload })
    .eq('id', messageId)
    .eq('tenant_id', tenantId);
  if (error) return NextResponse.json({ error: 'could not save' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
