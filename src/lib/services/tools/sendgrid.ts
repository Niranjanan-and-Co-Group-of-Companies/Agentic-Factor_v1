import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const SG = 'https://api.sendgrid.com/v3';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'sendgrid')
    .single();
  return data?.access_token ?? null;
}

function noCredError() {
  return { error: 'SendGrid not connected. Please add your SendGrid API key in the Connectors page.', connector_required: true, provider: 'sendgrid', connection_type: 'apikey' };
}

async function sgApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${SG}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

async function sendEmailTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { to, subject, html, text, from, from_name, reply_to, template_id, dynamic_template_data } = args as {
    to: string | string[]; subject: string; html?: string; text?: string;
    from: string; from_name?: string; reply_to?: string; template_id?: string; dynamic_template_data?: Record<string, unknown>;
  };
  if (!to || !from) return { error: 'to and from are required' };
  if (!template_id && !html && !text) return { error: 'html, text, or template_id is required' };
  const toList = Array.isArray(to) ? to : [to];
  const payload: Record<string, unknown> = {
    personalizations: [{ to: toList.map(email => ({ email })), dynamic_template_data }],
    from: { email: from, name: from_name },
    subject,
  };
  if (reply_to) payload.reply_to = { email: reply_to };
  if (template_id) {
    payload.template_id = template_id;
  } else {
    payload.content = html
      ? [{ type: 'text/html', value: html }]
      : [{ type: 'text/plain', value: text }];
  }
  const { status, data } = await sgApi(token, '/mail/send', 'POST', payload);
  if (status >= 400) return { error: `SendGrid error: ${JSON.stringify(data)}` };
  return { success: true, to: toList };
}

async function getStatsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { start_date, end_date } = args as { start_date: string; end_date?: string };
  const params = new URLSearchParams({ start_date: start_date || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0] });
  if (end_date) params.set('end_date', end_date);
  const { status, data } = await sgApi(token, `/stats?${params}`);
  if (status >= 400) return { error: `SendGrid error: ${JSON.stringify(data)}` };
  return { stats: data };
}

async function listTemplatesTool({ tenantId }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { status, data } = await sgApi(token, '/templates?generations=dynamic&page_size=20');
  if (status >= 400) return { error: `SendGrid error: ${JSON.stringify(data)}` };
  return { templates: (data as { result: Array<Record<string, string>> }).result ?? [] };
}

registerTool('sendgrid_send_email', sendEmailTool);
registerTool('sendgrid_get_stats', getStatsTool);
registerTool('sendgrid_list_templates', listTemplatesTool);
