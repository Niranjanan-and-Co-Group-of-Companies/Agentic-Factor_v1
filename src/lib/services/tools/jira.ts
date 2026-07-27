import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

async function getCredentials(tenantId: string): Promise<{ token: string; cloudId: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token, metadata')
    .eq('tenant_id', tenantId)
    .eq('provider', 'atlassian')
    .single();
  if (!data?.access_token) return null;
  const meta = data.metadata as Record<string, string> | null;
  let cloudId = meta?.jira_cloud_id ?? '';
  if (!cloudId) {
    const res = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${data.access_token}`, Accept: 'application/json' },
    });
    if (res.ok) {
      const resources = await res.json() as Array<{ id: string; name: string; scopes: string[] }>;
      const jiraResource = resources.find(r => r.scopes.some(s => s.includes('jira')));
      cloudId = jiraResource?.id ?? '';
      if (cloudId) {
        await supabase.from('tenant_permissions').update({ metadata: { ...meta, jira_cloud_id: cloudId } })
          .eq('tenant_id', tenantId).eq('provider', 'atlassian');
      }
    }
  }
  return cloudId ? { token: data.access_token, cloudId } : null;
}

function noCredError() {
  return { error: 'Jira not connected. Please connect Jira (Atlassian) in the Connectors page.', connector_required: true, provider: 'atlassian', connection_type: 'oauth' };
}

async function jiraApi(token: string, cloudId: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

async function createIssueTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { project_key, summary, description, issue_type = 'Task', priority, assignee_email, labels } = args as {
    project_key: string; summary: string; description?: string; issue_type?: string;
    priority?: string; assignee_email?: string; labels?: string[];
  };
  if (!project_key || !summary) return { error: 'project_key and summary are required' };
  const fields: Record<string, unknown> = {
    project: { key: project_key },
    summary,
    issuetype: { name: issue_type },
  };
  if (description) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] };
  if (priority) fields.priority = { name: priority };
  if (assignee_email) fields.assignee = { emailAddress: assignee_email };
  if (labels?.length) fields.labels = labels;
  const { status, data } = await jiraApi(creds.token, creds.cloudId, '/issue', 'POST', { fields });
  if (status >= 400) return { error: `Jira error: ${JSON.stringify(data)}` };
  const d = data as Record<string, string>;
  return { issue_id: d.id, issue_key: d.key, url: `https://your-domain.atlassian.net/browse/${d.key}` };
}

async function listIssuesTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { jql = 'project IS NOT EMPTY ORDER BY created DESC', max_results = 20 } = args as { jql?: string; max_results?: number };
  const { status, data } = await jiraApi(creds.token, creds.cloudId, `/search?jql=${encodeURIComponent(jql)}&maxResults=${Math.min(max_results, 100)}&fields=summary,status,assignee,priority,created,updated`);
  if (status >= 400) return { error: `Jira error: ${JSON.stringify(data)}` };
  const d = data as { issues: Array<Record<string, unknown>>; total: number };
  return {
    issues: d.issues?.map(i => ({
      key: i.key,
      id: i.id,
      summary: (i.fields as Record<string, Record<string, string>>)?.summary,
      status: (i.fields as Record<string, Record<string, string>>)?.status?.name,
      priority: (i.fields as Record<string, Record<string, string>>)?.priority?.name,
      assignee: (i.fields as Record<string, Record<string, string>>)?.assignee?.displayName,
    })) ?? [],
    total: d.total,
  };
}

async function addCommentTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { issue_key, comment } = args as { issue_key: string; comment: string };
  if (!issue_key || !comment) return { error: 'issue_key and comment are required' };
  const { status, data } = await jiraApi(creds.token, creds.cloudId, `/issue/${issue_key}/comment`, 'POST', {
    body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] },
  });
  if (status >= 400) return { error: `Jira error: ${JSON.stringify(data)}` };
  return { success: true, comment_id: (data as Record<string, string>).id };
}

async function transitionIssueTool({ tenantId, args }: ToolExecutionContext) {
  const creds = await getCredentials(tenantId);
  if (!creds) return noCredError();
  const { issue_key, transition_name } = args as { issue_key: string; transition_name: string };
  if (!issue_key || !transition_name) return { error: 'issue_key and transition_name are required' };
  const { status: ts, data: td } = await jiraApi(creds.token, creds.cloudId, `/issue/${issue_key}/transitions`);
  if (ts >= 400) return { error: `Jira error: ${JSON.stringify(td)}` };
  const transitions = (td as { transitions: Array<{ id: string; name: string }> }).transitions;
  const match = transitions.find(t => t.name.toLowerCase() === transition_name.toLowerCase());
  if (!match) return { error: `Transition "${transition_name}" not found. Available: ${transitions.map(t => t.name).join(', ')}` };
  const { status } = await jiraApi(creds.token, creds.cloudId, `/issue/${issue_key}/transitions`, 'POST', { transition: { id: match.id } });
  if (status >= 400) return { error: `Jira transition failed` };
  return { success: true, issue_key, new_status: transition_name };
}

registerTool('jira_create_issue', createIssueTool);
registerTool('jira_list_issues', listIssuesTool);
registerTool('jira_add_comment', addCommentTool);
registerTool('jira_transition_issue', transitionIssueTool);
