import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

// Zoho CRM uses OAuth. access_token stored directly in tenant_permissions.
// Instance domain can vary (e.g., crm.zoho.com vs crm.zoho.in) — stored as "TOKEN|DOMAIN"
async function getCredentials(tenantId: string): Promise<{ token: string; domain: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'zoho')
    .single();
  if (!data?.access_token) return null;
  const [token, domain] = data.access_token.split('|');
  return { token, domain: domain || 'crm.zoho.com' };
}

function noCredError() {
  return { error: 'Zoho not connected. Please connect Zoho in the Connectors page.', connector_required: true, provider: 'zoho' };
}

async function zohoApi(creds: { token: string; domain: string }, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://${creds.domain}/crm/v3${path}`, {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${creds.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function createLeadTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { Last_Name, Company, Email, First_Name, Phone, Lead_Source, Title, Description } = args as Record<string, string>;
  if (!Last_Name || !Company) return { error: 'Missing required arguments: Last_Name, Company' };
  const record: Record<string, string> = { Last_Name, Company };
  if (Email) record.Email = Email;
  if (First_Name) record.First_Name = First_Name;
  if (Phone) record.Phone = Phone;
  if (Lead_Source) record.Lead_Source = Lead_Source;
  if (Title) record.Title = Title;
  if (Description) record.Description = Description;
  const { status, data } = await zohoApi(creds, '/Leads', 'POST', { data: [record] });
  if (status >= 400) return { error: `Zoho error: ${JSON.stringify(data)}` };
  const result = (data as Record<string, Record<string, Record<string, string>>[]>).data?.[0];
  return { lead_id: result?.details?.id, status: result?.code };
}

async function updateLeadTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { lead_id, ...fields } = args as Record<string, string>;
  if (!lead_id) return { error: 'Missing required argument: lead_id' };
  const { status, data } = await zohoApi(creds, `/Leads/${lead_id}`, 'PUT', { data: [fields] });
  if (status >= 400) return { error: `Zoho error: ${JSON.stringify(data)}` };
  return { success: true, lead_id };
}

async function searchLeadsTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { email, criteria, limit = 10 } = args as { email?: string; criteria?: string; limit?: number };
  let path: string;
  if (email) {
    path = `/Leads/search?email=${encodeURIComponent(email)}&per_page=${limit}`;
  } else if (criteria) {
    path = `/Leads/search?criteria=${encodeURIComponent(criteria)}&per_page=${limit}`;
  } else {
    return { error: 'Provide email or criteria to search' };
  }
  const { status, data } = await zohoApi(creds, path);
  if (status === 204) return { leads: [] };
  if (status >= 400) return { error: `Zoho error: ${JSON.stringify(data)}` };
  return { leads: (data as Record<string, unknown>).data ?? [] };
}

async function createContactTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { Last_Name, Email, First_Name, Phone, Account_Name, Title } = args as Record<string, string>;
  if (!Last_Name) return { error: 'Missing required argument: Last_Name' };
  const record: Record<string, string> = { Last_Name };
  if (Email) record.Email = Email;
  if (First_Name) record.First_Name = First_Name;
  if (Phone) record.Phone = Phone;
  if (Account_Name) record.Account_Name = Account_Name;
  if (Title) record.Title = Title;
  const { status, data } = await zohoApi(creds, '/Contacts', 'POST', { data: [record] });
  if (status >= 400) return { error: `Zoho error: ${JSON.stringify(data)}` };
  const result = (data as Record<string, Record<string, Record<string, string>>[]>).data?.[0];
  return { contact_id: result?.details?.id, status: result?.code };
}

async function addNoteTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { parent_id, module = 'Leads', note_title, note_content } = args as Record<string, string>;
  if (!parent_id || !note_content) return { error: 'Missing required arguments: parent_id, note_content' };
  const { status, data } = await zohoApi(creds, '/Notes', 'POST', {
    data: [{ Parent_Id: { id: parent_id }, se_module: module, Note_Title: note_title ?? 'Agent Note', Note_Content: note_content }],
  });
  if (status >= 400) return { error: `Zoho error: ${JSON.stringify(data)}` };
  return { success: true };
}

registerTool('zoho_create_lead', createLeadTool);
registerTool('zoho_update_lead', updateLeadTool);
registerTool('zoho_search_leads', searchLeadsTool);
registerTool('zoho_create_contact', createContactTool);
registerTool('zoho_add_note', addNoteTool);
