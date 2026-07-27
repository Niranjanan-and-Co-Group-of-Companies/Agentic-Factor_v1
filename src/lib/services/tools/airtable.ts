import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const AT_BASE = 'https://api.airtable.com/v0';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'airtable')
    .single();
  return data?.access_token ?? null;
}

function noTokenError() {
  return { error: 'Airtable not connected. Please connect Airtable in the Connectors page.', connector_required: true, provider: 'airtable' };
}

async function atApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${AT_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function listRecordsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { base_id, table_name, filter_formula, max_records = 20, view } = args as { base_id: string; table_name: string; filter_formula?: string; max_records?: number; view?: string };
  if (!base_id || !table_name) return { error: 'Missing required arguments: base_id, table_name' };
  let path = `/${base_id}/${encodeURIComponent(table_name)}?maxRecords=${Math.min(max_records, 100)}`;
  if (filter_formula) path += `&filterByFormula=${encodeURIComponent(filter_formula)}`;
  if (view) path += `&view=${encodeURIComponent(view)}`;
  const { status, data } = await atApi(token, path);
  if (status >= 400) return { error: `Airtable error: ${(data as Record<string, Record<string, string>>).error?.message ?? JSON.stringify(data)}` };
  return { records: (data as Record<string, unknown>).records, offset: (data as Record<string, unknown>).offset };
}

async function createRecordTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { base_id, table_name, fields } = args as { base_id: string; table_name: string; fields: Record<string, unknown> };
  if (!base_id || !table_name || !fields) return { error: 'Missing required arguments: base_id, table_name, fields' };
  const { status, data } = await atApi(token, `/${base_id}/${encodeURIComponent(table_name)}`, 'POST', { fields });
  if (status >= 400) return { error: `Airtable error: ${(data as Record<string, Record<string, string>>).error?.message ?? JSON.stringify(data)}` };
  return { record_id: (data as Record<string, unknown>).id, fields: (data as Record<string, unknown>).fields };
}

async function updateRecordTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { base_id, table_name, record_id, fields } = args as { base_id: string; table_name: string; record_id: string; fields: Record<string, unknown> };
  if (!base_id || !table_name || !record_id || !fields) return { error: 'Missing required arguments: base_id, table_name, record_id, fields' };
  const { status, data } = await atApi(token, `/${base_id}/${encodeURIComponent(table_name)}/${record_id}`, 'PATCH', { fields });
  if (status >= 400) return { error: `Airtable error: ${(data as Record<string, Record<string, string>>).error?.message ?? JSON.stringify(data)}` };
  return { success: true, record_id, fields: (data as Record<string, unknown>).fields };
}

async function deleteRecordTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { base_id, table_name, record_id } = args as { base_id: string; table_name: string; record_id: string };
  if (!base_id || !table_name || !record_id) return { error: 'Missing required arguments: base_id, table_name, record_id' };
  const { status, data } = await atApi(token, `/${base_id}/${encodeURIComponent(table_name)}/${record_id}`, 'DELETE');
  if (status >= 400) return { error: `Airtable error: ${(data as Record<string, Record<string, string>>).error?.message ?? JSON.stringify(data)}` };
  return { success: true, deleted: (data as Record<string, unknown>).deleted };
}

registerTool('airtable_list_records', listRecordsTool);
registerTool('airtable_create_record', createRecordTool);
registerTool('airtable_update_record', updateRecordTool);
registerTool('airtable_delete_record', deleteRecordTool);
