import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

async function getCredentials(tenantId: string): Promise<{ token: string; dc: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token, metadata')
    .eq('tenant_id', tenantId)
    .eq('provider', 'mailchimp')
    .single();
  if (!data?.access_token) return null;
  const meta = data.metadata as Record<string, string> | null;
  let dc = meta?.datacenter ?? '';
  if (!dc) {
    const res = await fetch('https://login.mailchimp.com/oauth2/metadata', {
      headers: { Authorization: `OAuth ${data.access_token}` },
    });
    if (res.ok) {
      const info = await res.json() as { dc: string };
      dc = info.dc ?? 'us1';
      await supabase.from('tenant_permissions').update({ metadata: { ...meta, datacenter: dc } })
        .eq('tenant_id', tenantId).eq('provider', 'mailchimp');
    }
  }
  return { token: data.access_token, dc: dc || 'us1' };
}

function noCredError() {
  return { error: 'Mailchimp not connected. Please connect Mailchimp in the Connectors page.', connector_required: true, provider: 'mailchimp', connection_type: 'oauth' };
}

async function mcApi(token: string, dc: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://${dc}.api.mailchimp.com/3.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function listAudiencesTool({ tenantId }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { status, data } = await mcApi(creds.token, creds.dc, '/lists?count=20&fields=lists.id,lists.name,lists.stats');
  if (status >= 400) return { error: `Mailchimp error: ${JSON.stringify(data)}` };
  return { audiences: (data as { lists: Array<Record<string, unknown>> }).lists ?? [] };
}

async function addSubscriberTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { list_id, email, first_name, last_name, tags, status: subStatus = 'subscribed' } = args as {
    list_id: string; email: string; first_name?: string; last_name?: string; tags?: string[]; status?: string;
  };
  if (!list_id || !email) return { error: 'list_id and email are required' };
  const merge_fields: Record<string, string> = {};
  if (first_name) merge_fields.FNAME = first_name;
  if (last_name) merge_fields.LNAME = last_name;
  const subscriber: Record<string, unknown> = { email_address: email, status: subStatus };
  if (Object.keys(merge_fields).length) subscriber.merge_fields = merge_fields;
  if (tags?.length) subscriber.tags = tags;
  const md5 = email.toLowerCase().replace(/[^a-z0-9@.+_-]/g, '');
  const hash = Buffer.from(md5).toString('hex').slice(0, 32);
  const { status, data } = await mcApi(creds.token, creds.dc, `/lists/${list_id}/members/${hash}`, 'PUT', subscriber);
  if (status >= 400) return { error: `Mailchimp error: ${JSON.stringify(data)}` };
  return { success: true, email, status: (data as Record<string, string>).status };
}

async function removeSubscriberTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { list_id, email } = args as { list_id: string; email: string };
  if (!list_id || !email) return { error: 'list_id and email are required' };
  const hash = Buffer.from(email.toLowerCase()).toString('hex').slice(0, 32);
  const { status } = await mcApi(creds.token, creds.dc, `/lists/${list_id}/members/${hash}`, 'PATCH', { status: 'unsubscribed' });
  if (status >= 400) return { error: 'Failed to unsubscribe' };
  return { success: true, email };
}

async function createCampaignTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { list_id, subject, from_name, reply_to, preview_text } = args as {
    list_id: string; subject: string; from_name: string; reply_to: string; preview_text?: string;
  };
  if (!list_id || !subject || !from_name || !reply_to) return { error: 'list_id, subject, from_name and reply_to are required' };
  const settings: Record<string, string> = { subject_line: subject, from_name, reply_to };
  if (preview_text) settings.preview_text = preview_text;
  const { status, data } = await mcApi(creds.token, creds.dc, '/campaigns', 'POST', {
    type: 'regular', recipients: { list_id }, settings,
  });
  if (status >= 400) return { error: `Mailchimp error: ${JSON.stringify(data)}` };
  return { campaign_id: (data as Record<string, string>).id, status: (data as Record<string, string>).status };
}

registerTool('mailchimp_list_audiences', listAudiencesTool);
registerTool('mailchimp_add_subscriber', addSubscriberTool);
registerTool('mailchimp_remove_subscriber', removeSubscriberTool);
registerTool('mailchimp_create_campaign', createCampaignTool);
