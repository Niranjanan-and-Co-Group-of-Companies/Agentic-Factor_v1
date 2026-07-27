import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const ASANA = 'https://app.asana.com/api/1.0';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'asana')
    .single();
  return data?.access_token ?? null;
}

function noCredError() {
  return { error: 'Asana not connected. Please connect Asana in the Connectors page.', connector_required: true, provider: 'asana', connection_type: 'oauth' };
}

async function asanaApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${ASANA}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function listProjectsTool({ tenantId }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { status, data } = await asanaApi(token, '/projects?opt_fields=gid,name,color,archived&limit=20');
  if (status >= 400) return { error: `Asana error: ${JSON.stringify(data)}` };
  return { projects: (data as { data: Array<Record<string, string>> }).data ?? [] };
}

async function listTasksTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { project_id, assignee, completed = false, limit = 20 } = args as { project_id?: string; assignee?: string; completed?: boolean; limit?: number };
  let path = `/tasks?completed=${completed}&limit=${Math.min(limit, 100)}&opt_fields=gid,name,due_on,assignee,completed,notes`;
  if (project_id) path += `&project=${project_id}`;
  if (assignee) path += `&assignee=${assignee}`;
  const { status, data } = await asanaApi(token, path);
  if (status >= 400) return { error: `Asana error: ${JSON.stringify(data)}` };
  return { tasks: (data as { data: Array<Record<string, unknown>> }).data ?? [] };
}

async function createTaskTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { name, project_id, notes, due_on, assignee } = args as { name: string; project_id?: string; notes?: string; due_on?: string; assignee?: string };
  if (!name) return { error: 'name is required' };
  const task: Record<string, unknown> = { name };
  if (notes) task.notes = notes;
  if (due_on) task.due_on = due_on;
  if (assignee) task.assignee = assignee;
  if (project_id) task.projects = [project_id];
  const { status, data } = await asanaApi(token, '/tasks', 'POST', { data: task });
  if (status >= 400) return { error: `Asana error: ${JSON.stringify(data)}` };
  const d = (data as { data: Record<string, string> }).data;
  return { task_id: d.gid, name: d.name };
}

async function completeTaskTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { task_id } = args as { task_id: string };
  if (!task_id) return { error: 'task_id is required' };
  const { status, data } = await asanaApi(token, `/tasks/${task_id}`, 'PUT', { data: { completed: true } });
  if (status >= 400) return { error: `Asana error: ${JSON.stringify(data)}` };
  return { success: true, task_id };
}

async function addCommentTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { task_id, text } = args as { task_id: string; text: string };
  if (!task_id || !text) return { error: 'task_id and text are required' };
  const { status, data } = await asanaApi(token, `/tasks/${task_id}/stories`, 'POST', { data: { text } });
  if (status >= 400) return { error: `Asana error: ${JSON.stringify(data)}` };
  return { success: true, story_id: (data as { data: Record<string, string> }).data?.gid };
}

registerTool('asana_list_projects', listProjectsTool);
registerTool('asana_list_tasks', listTasksTool);
registerTool('asana_create_task', createTaskTool);
registerTool('asana_complete_task', completeTaskTool);
registerTool('asana_add_comment', addCommentTool);
