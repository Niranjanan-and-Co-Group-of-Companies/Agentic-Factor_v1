import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const TW_BASE = 'https://api.twitter.com/2';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'twitter')
    .single();
  return data?.access_token ?? null;
}

function noTokenError() {
  return { error: 'X (Twitter) not connected. Please connect X in the Connectors page.', connector_required: true, provider: 'twitter' };
}

async function twApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${TW_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function postTweetTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { text, reply_to_id } = args as { text: string; reply_to_id?: string };
  if (!text) return { error: 'Missing required argument: text' };
  if (text.length > 280) return { error: `Tweet too long (${text.length} chars, max 280)` };
  const body: Record<string, unknown> = { text };
  if (reply_to_id) body.reply = { in_reply_to_tweet_id: reply_to_id };
  const { status, data } = await twApi(token, '/tweets', 'POST', body);
  if (status >= 400) return { error: `Twitter error: ${(data as Record<string, string>).detail || JSON.stringify(data)}` };
  return { tweet_id: (data as Record<string, Record<string, unknown>>).data?.id, success: true };
}

async function getMentionsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { user_id, max_results = 10, since_id } = args as { user_id: string; max_results?: number; since_id?: string };
  if (!user_id) return { error: 'Missing required argument: user_id' };
  let path = `/users/${user_id}/mentions?tweet.fields=created_at,author_id,conversation_id&max_results=${Math.min(max_results, 100)}`;
  if (since_id) path += `&since_id=${since_id}`;
  const { status, data } = await twApi(token, path);
  if (status >= 400) return { error: `Twitter error: ${(data as Record<string, string>).detail || JSON.stringify(data)}` };
  return { tweets: (data as Record<string, unknown>).data ?? [], meta: (data as Record<string, unknown>).meta };
}

async function searchTweetsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { query, max_results = 10 } = args as { query: string; max_results?: number };
  if (!query) return { error: 'Missing required argument: query' };
  const { status, data } = await twApi(token, `/tweets/search/recent?query=${encodeURIComponent(query)}&tweet.fields=created_at,author_id,public_metrics&max_results=${Math.min(max_results, 100)}`);
  if (status >= 400) return { error: `Twitter error: ${(data as Record<string, string>).detail || JSON.stringify(data)}` };
  return { tweets: (data as Record<string, unknown>).data ?? [], meta: (data as Record<string, unknown>).meta };
}

async function getUserInfoTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noTokenError();
  const { username } = args as { username: string };
  if (!username) return { error: 'Missing required argument: username' };
  const { status, data } = await twApi(token, `/users/by/username/${username}?user.fields=description,public_metrics,verified`);
  if (status >= 400) return { error: `Twitter error: ${(data as Record<string, string>).detail || JSON.stringify(data)}` };
  return (data as Record<string, unknown>).data;
}

registerTool('twitter_post_tweet', postTweetTool);
registerTool('twitter_get_mentions', getMentionsTool);
registerTool('twitter_search_tweets', searchTweetsTool);
registerTool('twitter_get_user', getUserInfoTool);
