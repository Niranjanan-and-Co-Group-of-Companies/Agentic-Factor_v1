import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

async function getCredentials(tenantId: string): Promise<{ email: string; token: string; subdomain: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'zendesk')
    .single();
  if (!data?.access_token) return null;
  try {
    const parsed = JSON.parse(data.access_token) as { email: string; token: string; subdomain: string };
    return parsed;
  } catch { return null; }
}

function noCredError() {
  return { error: 'Zendesk not connected. Please add your Zendesk credentials in the Connectors page.', connector_required: true, provider: 'zendesk', connection_type: 'apikey' };
}

async function zdApi(email: string, token: string, subdomain: string, path: string, method = 'GET', body?: unknown) {
  const credentials = Buffer.from(`${email}/token:${token}`).toString('base64');
  const res = await fetch(`https://${subdomain}.zendesk.com/api/v2${path}`, {
    method,
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

async function listTicketsTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { status: ticketStatus = 'open', limit = 20 } = args as { status?: string; limit?: number };
  const { status, data } = await zdApi(creds.email, creds.token, creds.subdomain, `/tickets.json?status=${ticketStatus}&per_page=${Math.min(limit, 100)}`);
  if (status >= 400) return { error: `Zendesk error: ${JSON.stringify(data)}` };
  const d = data as { tickets: Array<Record<string, unknown>> };
  return { tickets: d.tickets?.map(t => ({ id: t.id, subject: t.subject, status: t.status, priority: t.priority, created_at: t.created_at })) ?? [] };
}

async function createTicketTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { subject, body, requester_email, requester_name, priority = 'normal', tags } = args as {
    subject: string; body: string; requester_email: string; requester_name?: string; priority?: string; tags?: string[];
  };
  if (!subject || !body || !requester_email) return { error: 'subject, body and requester_email are required' };
  const ticket: Record<string, unknown> = {
    subject,
    comment: { body },
    requester: { email: requester_email, name: requester_name },
    priority,
  };
  if (tags?.length) ticket.tags = tags;
  const { status, data } = await zdApi(creds.email, creds.token, creds.subdomain, '/tickets.json', 'POST', { ticket });
  if (status >= 400) return { error: `Zendesk error: ${JSON.stringify(data)}` };
  const d = data as { ticket: Record<string, unknown> };
  return { ticket_id: d.ticket?.id, url: d.ticket?.url };
}

async function addCommentTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { ticket_id, body, public_reply = true } = args as { ticket_id: number; body: string; public_reply?: boolean };
  if (!ticket_id || !body) return { error: 'ticket_id and body are required' };
  const { status, data } = await zdApi(creds.email, creds.token, creds.subdomain, `/tickets/${ticket_id}.json`, 'PUT', {
    ticket: { comment: { body, public: public_reply } },
  });
  if (status >= 400) return { error: `Zendesk error: ${JSON.stringify(data)}` };
  return { success: true, ticket_id };
}

async function updateTicketTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { ticket_id, ticket_status, priority, assignee_id, tags } = args as {
    ticket_id: number; ticket_status?: string; priority?: string; assignee_id?: number; tags?: string[];
  };
  if (!ticket_id) return { error: 'ticket_id is required' };
  const patch: Record<string, unknown> = {};
  if (ticket_status) patch.status = ticket_status;
  if (priority) patch.priority = priority;
  if (assignee_id) patch.assignee_id = assignee_id;
  if (tags) patch.tags = tags;
  const { status, data } = await zdApi(creds.email, creds.token, creds.subdomain, `/tickets/${ticket_id}.json`, 'PUT', { ticket: patch });
  if (status >= 400) return { error: `Zendesk error: ${JSON.stringify(data)}` };
  return { success: true, ticket_id };
}

registerTool('zendesk_list_tickets', listTicketsTool);
registerTool('zendesk_create_ticket', createTicketTool);
registerTool('zendesk_add_comment', addCommentTool);
registerTool('zendesk_update_ticket', updateTicketTool);
