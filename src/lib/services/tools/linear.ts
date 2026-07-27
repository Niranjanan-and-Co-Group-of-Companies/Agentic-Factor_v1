import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const LINEAR_GQL = 'https://api.linear.app/graphql';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'linear')
    .single();
  return data?.access_token ?? null;
}

function noCredError() {
  return { error: 'Linear not connected. Please add your Linear API key in the Connectors page.', connector_required: true, provider: 'linear', connection_type: 'apikey' };
}

async function linearQuery(token: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(LINEAR_GQL, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };
  if (json.errors?.length) return { error: `Linear error: ${json.errors[0].message}` };
  return json.data;
}

async function listTeamsTool({ tenantId }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const result = await linearQuery(token, `{ teams { nodes { id name key } } }`);
  if ('error' in (result ?? {})) return result;
  return { teams: (result as Record<string, { nodes: unknown[] }>)?.teams?.nodes ?? [] };
}

async function listIssuesTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { team_id, state, limit = 20 } = args as { team_id?: string; state?: string; limit?: number };
  const filter: Record<string, unknown> = {};
  if (team_id) filter.team = { id: { eq: team_id } };
  if (state) filter.state = { name: { eq: state } };
  const result = await linearQuery(token,
    `query($filter: IssueFilter, $first: Int) { issues(filter: $filter, first: $first, orderBy: updatedAt) { nodes { id title identifier state { name } priority assignee { name } createdAt } } }`,
    { filter: Object.keys(filter).length ? filter : undefined, first: Math.min(limit, 50) }
  );
  if ('error' in (result ?? {})) return result;
  return { issues: (result as Record<string, { nodes: unknown[] }>)?.issues?.nodes ?? [] };
}

async function createIssueTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { team_id, title, description, priority = 0, assignee_id } = args as {
    team_id: string; title: string; description?: string; priority?: number; assignee_id?: string;
  };
  if (!team_id || !title) return { error: 'team_id and title are required' };
  const input: Record<string, unknown> = { teamId: team_id, title, priority };
  if (description) input.description = description;
  if (assignee_id) input.assigneeId = assignee_id;
  const result = await linearQuery(token,
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }`,
    { input }
  );
  if ('error' in (result ?? {})) return result;
  const issue = (result as Record<string, { issue: Record<string, string> }>)?.issueCreate?.issue;
  return { issue_id: issue?.id, identifier: issue?.identifier, title: issue?.title, url: issue?.url };
}

async function addCommentTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { issue_id, body } = args as { issue_id: string; body: string };
  if (!issue_id || !body) return { error: 'issue_id and body are required' };
  const result = await linearQuery(token,
    `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }`,
    { input: { issueId: issue_id, body } }
  );
  if ('error' in (result ?? {})) return result;
  return { success: true };
}

registerTool('linear_list_teams', listTeamsTool);
registerTool('linear_list_issues', listIssuesTool);
registerTool('linear_create_issue', createIssueTool);
registerTool('linear_add_comment', addCommentTool);
