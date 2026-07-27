import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

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

async function readSheetTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { spreadsheet_id, range = 'Sheet1', major_dimension = 'ROWS' } = args as { spreadsheet_id: string; range?: string; major_dimension?: string };
  if (!spreadsheet_id) return { error: 'spreadsheet_id is required' };
  const res = await fetch(`${SHEETS}/${spreadsheet_id}/values/${encodeURIComponent(range)}?majorDimension=${major_dimension}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { error: `Google Sheets error: HTTP ${res.status}` };
  const data = await res.json() as { values?: string[][]; range?: string };
  return { range: data.range, rows: data.values ?? [], row_count: data.values?.length ?? 0 };
}

async function appendRowTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { spreadsheet_id, sheet_name = 'Sheet1', values } = args as { spreadsheet_id: string; sheet_name?: string; values: unknown[][] };
  if (!spreadsheet_id || !values) return { error: 'spreadsheet_id and values are required' };
  const res = await fetch(
    `${SHEETS}/${spreadsheet_id}/values/${encodeURIComponent(sheet_name)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) }
  );
  if (!res.ok) return { error: `Google Sheets error: HTTP ${res.status}` };
  const data = await res.json() as { updates?: Record<string, unknown> };
  return { success: true, updated_range: (data.updates as Record<string, string> | undefined)?.updatedRange, rows_added: values.length };
}

async function updateCellTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { spreadsheet_id, range, value } = args as { spreadsheet_id: string; range: string; value: unknown };
  if (!spreadsheet_id || !range || value === undefined) return { error: 'spreadsheet_id, range and value are required' };
  const res = await fetch(
    `${SHEETS}/${spreadsheet_id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [[value]] }) }
  );
  if (!res.ok) return { error: `Google Sheets error: HTTP ${res.status}` };
  return { success: true, range };
}

async function createSpreadsheetTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { title, sheets = ['Sheet1'] } = args as { title: string; sheets?: string[] };
  if (!title) return { error: 'title is required' };
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title }, sheets: sheets.map(s => ({ properties: { title: s } })) }),
  });
  if (!res.ok) return { error: `Google Sheets error: HTTP ${res.status}` };
  const data = await res.json() as { spreadsheetId: string; spreadsheetUrl: string };
  return { spreadsheet_id: data.spreadsheetId, url: data.spreadsheetUrl, title };
}

registerTool('google_sheets_read', readSheetTool);
registerTool('google_sheets_append_row', appendRowTool);
registerTool('google_sheets_update_cell', updateCellTool);
registerTool('google_sheets_create', createSpreadsheetTool);
