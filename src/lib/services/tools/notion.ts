import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'notion')
    .single();
  return data?.access_token ?? null;
}

function noTokenError() {
  return { error: 'Notion not connected. Please connect Notion in the Connectors page.', connector_required: true, provider: 'notion' };
}

async function notionApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${NOTION_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': NOTION_VERSION },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function createPageTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { parent_id, parent_type = 'page_id', title, content } = args as { parent_id: string; parent_type?: string; title: string; content?: string };
  if (!parent_id || !title) return { error: 'Missing required arguments: parent_id, title' };

  const children: unknown[] = [];
  if (content) {
    children.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } });
  }

  const body: Record<string, unknown> = {
    parent: { [parent_type]: parent_id },
    properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
  };
  if (children.length) body.children = children;

  const { status, data } = await notionApi(token, '/pages', 'POST', body);
  if (status >= 400) return { error: `Notion error: ${(data as Record<string, string>).message}` };
  return { page_id: (data as Record<string, unknown>).id, url: (data as Record<string, unknown>).url };
}

async function updatePageTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { page_id, title, properties } = args as { page_id: string; title?: string; properties?: Record<string, unknown> };
  if (!page_id) return { error: 'Missing required argument: page_id' };
  const updateProps: Record<string, unknown> = properties ?? {};
  if (title) updateProps.title = { title: [{ type: 'text', text: { content: title } }] };
  const { status, data } = await notionApi(token, `/pages/${page_id}`, 'PATCH', { properties: updateProps });
  if (status >= 400) return { error: `Notion error: ${(data as Record<string, string>).message}` };
  return { success: true, url: (data as Record<string, unknown>).url };
}

async function queryDatabaseTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { database_id, filter, sorts, limit = 20 } = args as { database_id: string; filter?: unknown; sorts?: unknown[]; limit?: number };
  if (!database_id) return { error: 'Missing required argument: database_id' };
  const body: Record<string, unknown> = { page_size: Math.min(limit, 100) };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;
  const { status, data } = await notionApi(token, `/databases/${database_id}/query`, 'POST', body);
  if (status >= 400) return { error: `Notion error: ${(data as Record<string, string>).message}` };
  return { results: (data as Record<string, unknown>).results, has_more: (data as Record<string, unknown>).has_more };
}

async function appendBlocksTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { block_id, text } = args as { block_id: string; text: string };
  if (!block_id || !text) return { error: 'Missing required arguments: block_id, text' };
  const children = [
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } },
  ];
  const { status, data } = await notionApi(token, `/blocks/${block_id}/children`, 'PATCH', { children });
  if (status >= 400) return { error: `Notion error: ${(data as Record<string, string>).message}` };
  return { success: true, blocks_added: ((data as Record<string, unknown[]>).results ?? []).length };
}

registerTool('notion_create_page', createPageTool);
registerTool('notion_update_page', updatePageTool);
registerTool('notion_query_database', queryDatabaseTool);
registerTool('notion_append_blocks', appendBlocksTool);
