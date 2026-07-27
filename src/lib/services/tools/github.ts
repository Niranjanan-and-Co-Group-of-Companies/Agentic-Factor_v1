import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const GITHUB_BASE = 'https://api.github.com';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'github')
    .single();
  return data?.access_token ?? null;
}

function noTokenError() {
  return { error: 'GitHub not connected. Please connect GitHub in the Connectors page.', connector_required: true, provider: 'github' };
}

async function ghApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${GITHUB_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

async function createIssueTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { owner, repo, title, body, labels, assignees } = args as {
    owner: string; repo: string; title: string; body?: string; labels?: string[]; assignees?: string[];
  };
  if (!owner || !repo || !title) return { error: 'Missing required arguments: owner, repo, title' };
  const { status, data } = await ghApi(token, `/repos/${owner}/${repo}/issues`, 'POST', { title, body, labels, assignees });
  if (status >= 400) return { error: `GitHub error: ${(data as Record<string, string>).message}` };
  return { issue_number: (data as Record<string, unknown>).number, url: (data as Record<string, unknown>).html_url, title };
}

async function listPRsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { owner, repo, state = 'open', limit = 10 } = args as { owner: string; repo: string; state?: string; limit?: number };
  if (!owner || !repo) return { error: 'Missing required arguments: owner, repo' };
  const { status, data } = await ghApi(token, `/repos/${owner}/${repo}/pulls?state=${state}&per_page=${Math.min(limit, 100)}`);
  if (status >= 400) return { error: `GitHub error: ${(data as Record<string, string>).message}` };
  const prs = (data as Record<string, unknown>[]).map(p => ({
    number: p.number, title: p.title, state: p.state, url: p.html_url,
    author: (p.user as Record<string, unknown>)?.login, created_at: p.created_at,
  }));
  return { pull_requests: prs };
}

async function addCommentTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { owner, repo, issue_number, body } = args as { owner: string; repo: string; issue_number: number; body: string };
  if (!owner || !repo || !issue_number || !body) return { error: 'Missing required arguments: owner, repo, issue_number, body' };
  const { status, data } = await ghApi(token, `/repos/${owner}/${repo}/issues/${issue_number}/comments`, 'POST', { body });
  if (status >= 400) return { error: `GitHub error: ${(data as Record<string, string>).message}` };
  return { comment_id: (data as Record<string, unknown>).id, url: (data as Record<string, unknown>).html_url };
}

async function createOrUpdateFileTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { owner, repo, path, content, message, branch, sha } = args as {
    owner: string; repo: string; path: string; content: string; message: string; branch?: string; sha?: string;
  };
  if (!owner || !repo || !path || !content || !message) return { error: 'Missing required arguments: owner, repo, path, content, message' };
  const encoded = Buffer.from(content).toString('base64');
  const body: Record<string, unknown> = { message, content: encoded };
  if (branch) body.branch = branch;
  if (sha) body.sha = sha;
  const { status, data } = await ghApi(token, `/repos/${owner}/${repo}/contents/${path}`, 'PUT', body);
  if (status >= 400) return { error: `GitHub error: ${(data as Record<string, string>).message}` };
  return { success: true, url: (data as Record<string, Record<string, unknown>>).content?.html_url };
}

async function searchRepositoriesTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { query, limit = 10 } = args as { query: string; limit?: number };
  if (!query) return { error: 'Missing required argument: query' };
  const { status, data } = await ghApi(token, `/search/repositories?q=${encodeURIComponent(query)}&per_page=${Math.min(limit, 30)}`);
  if (status >= 400) return { error: `GitHub error: ${(data as Record<string, string>).message}` };
  const repos = ((data as Record<string, Record<string, unknown>[]>).items ?? []).map(r => ({
    full_name: r.full_name, description: r.description, stars: r.stargazers_count,
    language: r.language, url: r.html_url,
  }));
  return { repositories: repos, total: (data as Record<string, number>).total_count };
}

registerTool('github_create_issue', createIssueTool);
registerTool('github_list_prs', listPRsTool);
registerTool('github_add_comment', addCommentTool);
registerTool('github_create_file', createOrUpdateFileTool);
registerTool('github_search_repos', searchRepositoriesTool);
