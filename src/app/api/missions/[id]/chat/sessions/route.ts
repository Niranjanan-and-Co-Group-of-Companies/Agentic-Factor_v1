import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// GET /api/missions/[id]/chat/sessions — list past chat sessions (left rail)
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const supabase = createServiceClient();

  try {
    const { data, error } = await supabase
      .from('mission_chats')
      .select('id, title, created_at, updated_at')
      .eq('mission_id', missionId)
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      // Table may not exist yet — return empty list gracefully
      if (error.code === '42P01') return NextResponse.json({ sessions: [] });
      throw error;
    }

    return NextResponse.json({ sessions: data ?? [] });
  } catch (err) {
    console.error('[chat/sessions GET]', err);
    return NextResponse.json({ sessions: [] });
  }
}

// GET /api/missions/[id]/chat/sessions?sessionId=xxx — load messages for a session
// (handled via query param on the GET above — see below)
// POST /api/missions/[id]/chat/sessions — load messages for a specific session
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const { sessionId } = await request.json() as { sessionId: string };
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  const supabase = createServiceClient();

  try {
    // Verify session belongs to this tenant AND this specific mission
    const { data: chatRow } = await supabase
      .from('mission_chats')
      .select('id')
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .eq('mission_id', missionId)
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
    console.error('[chat/sessions POST]', err);
    return NextResponse.json({ messages: [] });
  }
}
