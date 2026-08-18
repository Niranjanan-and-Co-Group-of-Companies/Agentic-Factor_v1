import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// Platform-level chat sessions use this sentinel as mission_id (NOT NULL constraint satisfied)
const PLATFORM_CHAT_SENTINEL = '00000000-0000-0000-0000-000000000000';

// GET /api/command-chat/sessions — list platform chat sessions
export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const supabase = createServiceClient();
  try {
    const { data, error } = await supabase
      .from('mission_chats')
      .select('id, title, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .eq('mission_id', PLATFORM_CHAT_SENTINEL)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      if (error.code === '42P01') return NextResponse.json({ sessions: [] });
      throw error;
    }
    return NextResponse.json({ sessions: data ?? [] });
  } catch (err) {
    console.error('[command-chat/sessions GET]', err);
    return NextResponse.json({ sessions: [] });
  }
}

// POST /api/command-chat/sessions — load messages for a session
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { sessionId } = await request.json() as { sessionId: string };
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  const supabase = createServiceClient();
  try {
    const { data: chatRow } = await supabase
      .from('mission_chats')
      .select('id')
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .eq('mission_id', PLATFORM_CHAT_SENTINEL)
      .maybeSingle();
    if (!chatRow) return NextResponse.json({ messages: [] });

    const { data, error } = await supabase
      .from('mission_chat_messages')
      .select('id, role, content, action_payload, action_applied, created_at')
      .eq('chat_id', sessionId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      if (error.code === '42P01') return NextResponse.json({ messages: [] });
      throw error;
    }
    return NextResponse.json({ messages: data ?? [] });
  } catch (err) {
    console.error('[command-chat/sessions POST]', err);
    return NextResponse.json({ messages: [] });
  }
}

// DELETE /api/command-chat/sessions — delete a session
export async function DELETE(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { sessionId } = await request.json() as { sessionId: string };
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('mission_chats')
    .delete()
    .eq('id', sessionId)
    .eq('tenant_id', tenantId)
    .eq('mission_id', PLATFORM_CHAT_SENTINEL);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
