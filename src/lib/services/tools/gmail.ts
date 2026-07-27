import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'google')
    .single();
  return data?.access_token ?? null;
}

function noCredError() {
  return { error: 'Google not connected. Please connect Google in the Connectors page.', connector_required: true, provider: 'google', connection_type: 'oauth' };
}

function makeRfc2822(to: string | string[], subject: string, body: string, from?: string, cc?: string, replyTo?: string): string {
  const toLine = Array.isArray(to) ? to.join(', ') : to;
  const headers = [`To: ${toLine}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8'];
  if (from) headers.unshift(`From: ${from}`);
  if (cc) headers.push(`Cc: ${cc}`);
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + body).toString('base64url');
}

async function sendEmailTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { to, subject, body, from, cc, reply_to, thread_id } = args as {
    to: string | string[]; subject: string; body: string;
    from?: string; cc?: string; reply_to?: string; thread_id?: string;
  };
  if (!to || !subject || !body) return { error: 'to, subject and body are required' };
  const raw = makeRfc2822(to, subject, body, from, cc, reply_to);
  const payload: Record<string, string> = { raw };
  if (thread_id) payload.threadId = thread_id;
  const res = await fetch(`${GMAIL}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { error: `Gmail error: HTTP ${res.status}` };
  const data = await res.json() as { id: string; threadId: string };
  return { message_id: data.id, thread_id: data.threadId };
}

async function readInboxTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { max_results = 10, query = 'in:inbox', label_ids } = args as { max_results?: number; query?: string; label_ids?: string[] };
  const params = new URLSearchParams({ maxResults: String(Math.min(max_results, 50)), q: query });
  if (label_ids?.length) params.set('labelIds', label_ids.join(','));
  const listRes = await fetch(`${GMAIL}/messages?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!listRes.ok) return { error: `Gmail error: HTTP ${listRes.status}` };
  const listData = await listRes.json() as { messages?: Array<{ id: string }> };
  if (!listData.messages?.length) return { emails: [], total: 0 };

  const emails = await Promise.all(listData.messages.slice(0, 10).map(async m => {
    const msgRes = await fetch(`${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!msgRes.ok) return null;
    const msg = await msgRes.json() as { id: string; threadId: string; snippet: string; payload: { headers: Array<{ name: string; value: string }> } };
    const h = Object.fromEntries(msg.payload.headers.map(hdr => [hdr.name.toLowerCase(), hdr.value]));
    return { id: msg.id, thread_id: msg.threadId, from: h.from, to: h.to, subject: h.subject, date: h.date, snippet: msg.snippet };
  }));

  return { emails: emails.filter(Boolean), total: listData.messages.length };
}

async function searchEmailsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { query, max_results = 20 } = args as { query: string; max_results?: number };
  if (!query) return { error: 'query is required (Gmail search syntax)' };
  const params = new URLSearchParams({ maxResults: String(Math.min(max_results, 100)), q: query });
  const res = await fetch(`${GMAIL}/messages?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { error: `Gmail error: HTTP ${res.status}` };
  const data = await res.json() as { messages?: Array<{ id: string }>; resultSizeEstimate?: number };
  return { message_ids: data.messages?.map(m => m.id) ?? [], estimated_total: data.resultSizeEstimate ?? 0 };
}

async function createDraftTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { to, subject, body, from } = args as { to: string; subject: string; body: string; from?: string };
  if (!to || !subject || !body) return { error: 'to, subject and body are required' };
  const raw = makeRfc2822(to, subject, body, from);
  const res = await fetch(`${GMAIL}/drafts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) return { error: `Gmail error: HTTP ${res.status}` };
  const data = await res.json() as { id: string };
  return { draft_id: data.id, to, subject };
}

registerTool('gmail_send', sendEmailTool);
registerTool('gmail_read_inbox', readInboxTool);
registerTool('gmail_search', searchEmailsTool);
registerTool('gmail_create_draft', createDraftTool);
