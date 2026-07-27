import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'microsoft')
    .single();
  return data?.access_token ?? null;
}

function noCredError() {
  return { error: 'Microsoft 365 not connected. Please connect Microsoft in the Connectors page.', connector_required: true, provider: 'microsoft', connection_type: 'oauth' };
}

async function graphApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

async function listTeamsTool({ tenantId }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { status, data } = await graphApi(token, '/me/joinedTeams');
  if (status >= 400) return { error: `Microsoft Teams error: ${JSON.stringify(data)}` };
  const d = data as { value: Array<Record<string, string>> };
  return { teams: d.value?.map(t => ({ id: t.id, name: t.displayName, description: t.description })) ?? [] };
}

async function listChannelsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { team_id } = args as { team_id: string };
  if (!team_id) return { error: 'team_id is required' };
  const { status, data } = await graphApi(token, `/teams/${team_id}/channels`);
  if (status >= 400) return { error: `Microsoft Teams error: ${JSON.stringify(data)}` };
  const d = data as { value: Array<Record<string, string>> };
  return { channels: d.value?.map(c => ({ id: c.id, name: c.displayName, description: c.description })) ?? [] };
}

async function postChannelMessageTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { team_id, channel_id, content, content_type = 'text' } = args as {
    team_id: string; channel_id: string; content: string; content_type?: string;
  };
  if (!team_id || !channel_id || !content) return { error: 'team_id, channel_id and content are required' };
  const { status, data } = await graphApi(token, `/teams/${team_id}/channels/${channel_id}/messages`, 'POST', {
    body: { contentType: content_type, content },
  });
  if (status >= 400) return { error: `Microsoft Teams error: ${JSON.stringify(data)}` };
  const d = data as Record<string, string>;
  return { message_id: d.id, created_at: d.createdDateTime };
}

async function sendChatMessageTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { user_email, content } = args as { user_email: string; content: string };
  if (!user_email || !content) return { error: 'user_email and content are required' };
  const chatRes = await graphApi(token, '/chats', 'POST', {
    chatType: 'oneOnOne',
    members: [
      { '@odata.type': '#microsoft.graph.aadUserConversationMember', 'user@odata.bind': 'https://graph.microsoft.com/v1.0/me', roles: ['owner'] },
      { '@odata.type': '#microsoft.graph.aadUserConversationMember', 'user@odata.bind': `https://graph.microsoft.com/v1.0/users/${user_email}`, roles: ['owner'] },
    ],
  });
  if (chatRes.status >= 400) return { error: `Failed to create chat: ${JSON.stringify(chatRes.data)}` };
  const chatId = (chatRes.data as Record<string, string>).id;
  const { status, data } = await graphApi(token, `/chats/${chatId}/messages`, 'POST', {
    body: { contentType: 'text', content },
  });
  if (status >= 400) return { error: `Microsoft Teams error: ${JSON.stringify(data)}` };
  return { success: true, chat_id: chatId, message_id: (data as Record<string, string>).id };
}

registerTool('teams_list_teams', listTeamsTool);
registerTool('teams_list_channels', listChannelsTool);
registerTool('teams_post_message', postChannelMessageTool);
registerTool('teams_send_dm', sendChatMessageTool);
