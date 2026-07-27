import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const SLACK_BASE = 'https://slack.com/api';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'slack')
    .single();
  return data?.access_token ?? null;
}

function noTokenError() {
  return { error: 'Slack not connected. Please connect Slack in the Connectors page.', connector_required: true, provider: 'slack' };
}

async function slackApi(token: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`${SLACK_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function postMessageTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { channel, text, thread_ts } = args as { channel: string; text: string; thread_ts?: string };
  if (!channel || !text) return { error: 'Missing required arguments: channel, text' };
  const body: Record<string, unknown> = { channel, text };
  if (thread_ts) body.thread_ts = thread_ts;
  const data = await slackApi(token, 'chat.postMessage', body);
  if (!data.ok) return { error: `Slack error: ${data.error}` };
  return { success: true, ts: data.ts, channel: data.channel };
}

async function readChannelTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { channel, limit = 10, oldest } = args as { channel: string; limit?: number; oldest?: string };
  if (!channel) return { error: 'Missing required argument: channel' };
  const body: Record<string, unknown> = { channel, limit: Math.min(limit, 100) };
  if (oldest) body.oldest = oldest;
  const data = await slackApi(token, 'conversations.history', body);
  if (!data.ok) return { error: `Slack error: ${data.error}` };
  const messages = (data.messages ?? []).map((m: Record<string, unknown>) => ({
    ts: m.ts, user: m.user, text: m.text, thread_ts: m.thread_ts,
  }));
  return { messages, has_more: data.has_more };
}

async function listChannelsTool({ tenantId }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const data = await slackApi(token, 'conversations.list', { exclude_archived: true, limit: 100 });
  if (!data.ok) return { error: `Slack error: ${data.error}` };
  const channels = (data.channels ?? []).map((c: Record<string, unknown>) => ({
    id: c.id, name: c.name, is_private: c.is_private, num_members: c.num_members,
  }));
  return { channels };
}

async function uploadFileTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { channel, filename, content, title } = args as { channel: string; filename: string; content: string; title?: string };
  if (!channel || !filename || !content) return { error: 'Missing required arguments: channel, filename, content' };
  const form = new FormData();
  form.append('channels', channel);
  form.append('filename', filename);
  form.append('content', content);
  if (title) form.append('title', title);
  const res = await fetch(`${SLACK_BASE}/files.upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json();
  if (!data.ok) return { error: `Slack error: ${data.error}` };
  return { success: true, file_id: data.file?.id, permalink: data.file?.permalink };
}

registerTool('slack_post_message', postMessageTool);
registerTool('slack_read_channel', readChannelTool);
registerTool('slack_list_channels', listChannelsTool);
registerTool('slack_upload_file', uploadFileTool);
