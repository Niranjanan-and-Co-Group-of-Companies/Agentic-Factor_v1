import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const MONDAY_GQL = 'https://api.monday.com/v2';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'monday')
    .single();
  return data?.access_token ?? null;
}

function noCredError() {
  return { error: 'Monday.com not connected. Please connect Monday in the Connectors page.', connector_required: true, provider: 'monday', connection_type: 'oauth' };
}

async function mondayQuery(token: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(MONDAY_GQL, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json', 'API-Version': '2024-01' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };
  if (json.errors?.length) return { error: `Monday.com error: ${json.errors[0].message}` };
  return json.data;
}

async function listBoardsTool({ tenantId }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const result = await mondayQuery(token, `{ boards(limit: 20) { id name description state } }`);
  if ('error' in (result ?? {})) return result;
  return { boards: (result as Record<string, Array<Record<string, unknown>>>)?.boards ?? [] };
}

async function listItemsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { board_id, limit = 20 } = args as { board_id: string; limit?: number };
  if (!board_id) return { error: 'board_id is required' };
  const result = await mondayQuery(token, `query($boardId: ID!, $limit: Int) { boards(ids: [$boardId]) { items_page(limit: $limit) { items { id name state column_values { id text } } } } }`, { boardId: board_id, limit });
  if ('error' in (result ?? {})) return result;
  const boards = (result as Record<string, Array<Record<string, unknown>>>)?.boards ?? [];
  const items = (boards[0]?.items_page as Record<string, unknown>)?.items ?? [];
  return { items };
}

async function createItemTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { board_id, item_name, group_id, column_values } = args as {
    board_id: string; item_name: string; group_id?: string; column_values?: Record<string, unknown>;
  };
  if (!board_id || !item_name) return { error: 'board_id and item_name are required' };
  const result = await mondayQuery(token,
    `mutation($boardId: ID!, $itemName: String!, $groupId: String, $columnValues: JSON) { create_item(board_id: $boardId, item_name: $itemName, group_id: $groupId, column_values: $columnValues) { id name } }`,
    { boardId: board_id, itemName: item_name, groupId: group_id, columnValues: column_values ? JSON.stringify(column_values) : undefined }
  );
  if ('error' in (result ?? {})) return result;
  return { item: (result as Record<string, Record<string, string>>)?.create_item };
}

async function updateItemTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { board_id, item_id, column_values } = args as { board_id: string; item_id: string; column_values: Record<string, unknown> };
  if (!board_id || !item_id || !column_values) return { error: 'board_id, item_id and column_values are required' };
  const result = await mondayQuery(token,
    `mutation($boardId: ID!, $itemId: ID!, $columnValues: JSON!) { change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id } }`,
    { boardId: board_id, itemId: item_id, columnValues: JSON.stringify(column_values) }
  );
  if ('error' in (result ?? {})) return result;
  return { success: true, item_id };
}

registerTool('monday_list_boards', listBoardsTool);
registerTool('monday_list_items', listItemsTool);
registerTool('monday_create_item', createItemTool);
registerTool('monday_update_item', updateItemTool);
