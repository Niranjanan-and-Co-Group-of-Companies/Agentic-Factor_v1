import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const HS_BASE = 'https://api.hubapi.com';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'hubspot')
    .single();
  return data?.access_token ?? null;
}

function noTokenError() {
  return { error: 'HubSpot not connected. Please connect HubSpot in the Connectors page.', connector_required: true, provider: 'hubspot' };
}

async function hsApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${HS_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function createContactTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { email, firstname, lastname, company, phone, jobtitle, website } = args as Record<string, string>;
  if (!email) return { error: 'Missing required argument: email' };
  const properties: Record<string, string> = { email };
  if (firstname) properties.firstname = firstname;
  if (lastname) properties.lastname = lastname;
  if (company) properties.company = company;
  if (phone) properties.phone = phone;
  if (jobtitle) properties.jobtitle = jobtitle;
  if (website) properties.website = website;
  const { status, data } = await hsApi(token, '/crm/v3/objects/contacts', 'POST', { properties });
  if (status >= 400) return { error: `HubSpot error: ${(data as Record<string, string>).message}` };
  return { contact_id: (data as Record<string, unknown>).id, success: true };
}

async function updateContactTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { contact_id, ...rest } = args as Record<string, string>;
  if (!contact_id) return { error: 'Missing required argument: contact_id' };
  const properties = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  const { status, data } = await hsApi(token, `/crm/v3/objects/contacts/${contact_id}`, 'PATCH', { properties });
  if (status >= 400) return { error: `HubSpot error: ${(data as Record<string, string>).message}` };
  return { success: true, contact_id };
}

async function getContactTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { email, contact_id } = args as { email?: string; contact_id?: string };
  if (!email && !contact_id) return { error: 'Provide email or contact_id' };
  let path: string;
  if (contact_id) {
    path = `/crm/v3/objects/contacts/${contact_id}?properties=email,firstname,lastname,company,jobtitle,phone,hs_lead_status`;
  } else {
    path = `/crm/v3/objects/contacts/search`;
  }
  if (email && !contact_id) {
    const { status, data } = await hsApi(token, path, 'POST', {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ['email', 'firstname', 'lastname', 'company', 'jobtitle', 'phone', 'hs_lead_status'],
    });
    if (status >= 400) return { error: `HubSpot error: ${(data as Record<string, string>).message}` };
    const results = (data as Record<string, unknown[]>).results ?? [];
    if (results.length === 0) return { found: false };
    return { found: true, contact: results[0] };
  }
  const { status, data } = await hsApi(token, path);
  if (status >= 400) return { error: `HubSpot error: ${(data as Record<string, string>).message}` };
  return { found: true, contact: data };
}

async function createDealTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { dealname, amount, pipeline, dealstage, contact_id, closedate } = args as Record<string, string>;
  if (!dealname) return { error: 'Missing required argument: dealname' };
  const properties: Record<string, string> = { dealname };
  if (amount) properties.amount = amount;
  if (pipeline) properties.pipeline = pipeline;
  if (dealstage) properties.dealstage = dealstage;
  if (closedate) properties.closedate = closedate;
  const body: Record<string, unknown> = { properties };
  if (contact_id) {
    body.associations = [{ to: { id: contact_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }];
  }
  const { status, data } = await hsApi(token, '/crm/v3/objects/deals', 'POST', body);
  if (status >= 400) return { error: `HubSpot error: ${(data as Record<string, string>).message}` };
  return { deal_id: (data as Record<string, unknown>).id, success: true };
}

async function logActivityTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { contact_id, note, activity_type = 'NOTE' } = args as { contact_id: string; note: string; activity_type?: string };
  if (!contact_id || !note) return { error: 'Missing required arguments: contact_id, note' };
  const properties: Record<string, unknown> = { hs_note_body: note, hs_timestamp: Date.now() };
  const body: Record<string, unknown> = {
    properties,
    associations: [{ to: { id: contact_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }],
  };
  const endpoint = activity_type === 'EMAIL' ? '/crm/v3/objects/emails' : '/crm/v3/objects/notes';
  const { status, data } = await hsApi(token, endpoint, 'POST', body);
  if (status >= 400) return { error: `HubSpot error: ${(data as Record<string, string>).message}` };
  return { success: true, activity_id: (data as Record<string, unknown>).id };
}

registerTool('hubspot_create_contact', createContactTool);
registerTool('hubspot_update_contact', updateContactTool);
registerTool('hubspot_get_contact', getContactTool);
registerTool('hubspot_create_deal', createDealTool);
registerTool('hubspot_log_activity', logActivityTool);
