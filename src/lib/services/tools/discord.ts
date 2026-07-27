import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const DC_BASE = 'https://discord.com/api/v10';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'discord')
    .single();
  return data?.access_token ?? null;
}

function noTokenError() {
  return { error: 'Discord not connected. Please connect Discord in the Connectors page.', connector_required: true, provider: 'discord' };
}

async function dcApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${DC_BASE}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { status: 204, data: null };
  return { status: res.status, data: await res.json() };
}

async function postMessageTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { channel_id, content, embeds } = args as { channel_id: string; content: string; embeds?: unknown[] };
  if (!channel_id || !content) return { error: 'Missing required arguments: channel_id, content' };
  const body: Record<string, unknown> = { content };
  if (embeds?.length) body.embeds = embeds;
  const { status, data } = await dcApi(token, `/channels/${channel_id}/messages`, 'POST', body);
  if (status >= 400) return { error: `Discord error: ${(data as Record<string, string>).message}` };
  return { message_id: (data as Record<string, unknown>).id, success: true };
}

async function listChannelsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { guild_id } = args as { guild_id: string };
  if (!guild_id) return { error: 'Missing required argument: guild_id' };
  const { status, data } = await dcApi(token, `/guilds/${guild_id}/channels`);
  if (status >= 400) return { error: `Discord error: ${(data as Record<string, string>).message}` };
  const channels = (data as Record<string, unknown>[]).map(c => ({
    id: c.id, name: c.name, type: c.type,
  }));
  return { channels };
}

async function createThreadTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { channel_id, name, message_id, auto_archive_duration = 1440 } = args as { channel_id: string; name: string; message_id?: string; auto_archive_duration?: number };
  if (!channel_id || !name) return { error: 'Missing required arguments: channel_id, name' };
  const path = message_id
    ? `/channels/${channel_id}/messages/${message_id}/threads`
    : `/channels/${channel_id}/threads`;
  const { status, data } = await dcApi(token, path, 'POST', { name, auto_archive_duration });
  if (status >= 400) return { error: `Discord error: ${(data as Record<string, string>).message}` };
  return { thread_id: (data as Record<string, unknown>).id, name };
}

registerTool('discord_post_message', postMessageTool);
registerTool('discord_list_channels', listChannelsTool);
registerTool('discord_create_thread', createThreadTool);
