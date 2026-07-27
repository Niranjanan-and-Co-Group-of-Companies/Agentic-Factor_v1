import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

async function getCredentials(tenantId: string): Promise<{ accessToken: string; instanceUrl: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token, refresh_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'salesforce')
    .single();
  if (!data?.access_token) return null;
  // access_token stored as "ACCESS_TOKEN|INSTANCE_URL"
  const [accessToken, instanceUrl] = data.access_token.split('|');
  if (!accessToken || !instanceUrl) return null;
  return { accessToken, instanceUrl };
}

function noCredError() {
  return { error: 'Salesforce not connected. Please connect Salesforce in the Connectors page.', connector_required: true, provider: 'salesforce' };
}

async function sfApi(creds: { accessToken: string; instanceUrl: string }, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${creds.instanceUrl}/services/data/v59.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { status: 204, data: null };
  return { status: res.status, data: await res.json() };
}

async function createLeadTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { LastName, Company, Email, FirstName, Title, Phone, LeadSource, Status } = args as Record<string, string>;
  if (!LastName || !Company) return { error: 'Missing required arguments: LastName, Company' };
  const fields: Record<string, string> = { LastName, Company };
  if (Email) fields.Email = Email;
  if (FirstName) fields.FirstName = FirstName;
  if (Title) fields.Title = Title;
  if (Phone) fields.Phone = Phone;
  if (LeadSource) fields.LeadSource = LeadSource;
  if (Status) fields.Status = Status;
  const { status, data } = await sfApi(creds, '/sobjects/Lead', 'POST', fields);
  if (status >= 400) return { error: `Salesforce error: ${JSON.stringify(data)}` };
  return { lead_id: (data as Record<string, unknown>).id, success: true };
}

async function updateLeadTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { lead_id, ...fields } = args as Record<string, string>;
  if (!lead_id) return { error: 'Missing required argument: lead_id' };
  const { status, data } = await sfApi(creds, `/sobjects/Lead/${lead_id}`, 'PATCH', fields);
  if (status >= 400) return { error: `Salesforce error: ${JSON.stringify(data)}` };
  return { success: true, lead_id };
}

async function createContactTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { LastName, Email, FirstName, Title, Phone, AccountId } = args as Record<string, string>;
  if (!LastName) return { error: 'Missing required argument: LastName' };
  const fields: Record<string, string> = { LastName };
  if (Email) fields.Email = Email;
  if (FirstName) fields.FirstName = FirstName;
  if (Title) fields.Title = Title;
  if (Phone) fields.Phone = Phone;
  if (AccountId) fields.AccountId = AccountId;
  const { status, data } = await sfApi(creds, '/sobjects/Contact', 'POST', fields);
  if (status >= 400) return { error: `Salesforce error: ${JSON.stringify(data)}` };
  return { contact_id: (data as Record<string, unknown>).id, success: true };
}

async function logActivityTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { WhoId, Subject, Description, ActivityDate, Type = 'Email' } = args as Record<string, string>;
  if (!WhoId || !Subject) return { error: 'Missing required arguments: WhoId, Subject' };
  const fields: Record<string, string> = { WhoId, Subject, Type };
  if (Description) fields.Description = Description;
  if (ActivityDate) fields.ActivityDate = ActivityDate;
  const { status, data } = await sfApi(creds, '/sobjects/Task', 'POST', fields);
  if (status >= 400) return { error: `Salesforce error: ${JSON.stringify(data)}` };
  return { task_id: (data as Record<string, unknown>).id, success: true };
}

async function searchRecordsTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { soql } = args as { soql: string };
  if (!soql) return { error: 'Missing required argument: soql (SOQL query string)' };
  const { status, data } = await sfApi(creds, `/query?q=${encodeURIComponent(soql)}`);
  if (status >= 400) return { error: `Salesforce error: ${JSON.stringify(data)}` };
  return { records: (data as Record<string, unknown>).records, total: (data as Record<string, unknown>).totalSize };
}

registerTool('salesforce_create_lead', createLeadTool);
registerTool('salesforce_update_lead', updateLeadTool);
registerTool('salesforce_create_contact', createContactTool);
registerTool('salesforce_log_activity', logActivityTool);
registerTool('salesforce_query', searchRecordsTool);
