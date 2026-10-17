import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { userEmail } from '@/lib/services/approvals';
import { entryText, saveToChat, saveToMissionChat, validateEntry, type ChatEntry } from '@/lib/services/chat-log';
import { decisionText, type ApprovalRecordPayload } from '@/lib/services/approval-records';
import { PLATFORM_CHAT_SENTINEL } from '@/lib/services/platform-chat';

// ============================================================
// POST /api/chat-log — save what a chat button did into chat history
// Body: { entry, missionId?, commandSessionId? }
//   entry: an action result ("Schedule set: Every Monday 9am"), a run
//   card, or an approval record already saved in its mission's chat.
//   missionId → that mission's chat; commandSessionId → that Command
//   Center conversation (so its history keeps it too).
// The text stored for the assistant is written here, never taken
// from the client.
// ============================================================

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId, userId } = authResult;

  const body = await request.json().catch(() => ({})) as { entry?: unknown; missionId?: string; commandSessionId?: string };
  const supabase = createServiceClient();

  // An approval record arrives already decided and saved in its mission's chat; it is only copied
  // into a Command Center conversation, after checking it is real and this workspace's.
  const raw = body.entry as Partial<ApprovalRecordPayload> & { missionId?: string; missionTitle?: string } | undefined;
  let entry: ChatEntry | null = null;
  let text = '';
  if (raw?.type === 'approval_record' && typeof raw.actionId === 'string') {
    const { data: action } = await supabase.from('proposed_actions').select('id, status').eq('id', raw.actionId).eq('tenant_id', tenantId).maybeSingle();
    if (!action || (action.status !== 'approved' && action.status !== 'rejected')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    entry = { ...(raw as ApprovalRecordPayload), decision: action.status };
    text = decisionText(entry as ApprovalRecordPayload);
  } else {
    const valid = validateEntry(body.entry);
    if (!valid) return NextResponse.json({ error: 'invalid entry' }, { status: 400 });
    if (valid.type === 'action_result') valid.by = await userEmail(userId);
    entry = valid;
    text = entryText(valid);
  }

  const saved: Record<string, string | null> = {};

  if (body.missionId && entry.type !== 'approval_record') {
    const { data: mission } = await supabase.from('missions').select('id').eq('id', body.missionId).eq('tenant_id', tenantId).maybeSingle();
    if (!mission) return NextResponse.json({ error: 'mission not found' }, { status: 404 });
    saved.mission = await saveToMissionChat(supabase, tenantId, body.missionId, entry, text);
  }

  if (body.commandSessionId) {
    const { data: session } = await supabase.from('mission_chats').select('id')
      .eq('id', body.commandSessionId).eq('tenant_id', tenantId).eq('mission_id', PLATFORM_CHAT_SENTINEL).maybeSingle();
    if (session) saved.command = await saveToChat(supabase, tenantId, body.commandSessionId, entry, text);
  }

  return NextResponse.json({ saved, entry, text });
}
