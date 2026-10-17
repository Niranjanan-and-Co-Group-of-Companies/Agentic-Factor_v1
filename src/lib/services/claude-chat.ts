/**
 * Chat (Command Center, mission chat) streams straight from the Anthropic Messages API. The latest
 * Claude model leads; if this account cannot use it, the next one answers instead of the chat
 * dropping to the tool-less router fallback.
 */
export const CHAT_MODELS = ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6'];

/**
 * Prompt caching. A chat's system prompt is written as parts joined by CACHE_SPLIT: every part but the
 * last (the fixed instructions, then the mission's own details) is cached, and the last part — what
 * changes every turn (time, runs, credits) — is not. Inside a tool loop the latest message is cached
 * too, so the next round re-reads the conversation at the cache price; a plain reply doesn't, since
 * caching costs 25% more than reading the tokens once and the next turn's context has changed anyway.
 */
export const CACHE_SPLIT = '\n\n<<AF_CACHE_SPLIT>>\n\n';

/** The system prompt as one plain string (for providers without prompt caching). */
export function plainSystem(system: string): string {
  return system.split(CACHE_SPLIT).join('\n\n');
}

type TextBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

export function cachedSystem(system: string): string | TextBlock[] {
  const parts = system.split(CACHE_SPLIT).filter(p => p.trim());
  if (parts.length < 2) return plainSystem(system);
  return parts.map((text, i) => ({ type: 'text' as const, text, ...(i < parts.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}) }));
}

/** The messages with a cache point on the last one (its last text or tool block). */
export function withCachedHistory<M extends { role: string; content: unknown }>(messages: M[]): M[] {
  if (messages.length === 0) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  const mark = { cache_control: { type: 'ephemeral' as const } };
  if (typeof last.content === 'string') {
    if (!last.content.trim()) return messages;
    out[out.length - 1] = { ...last, content: [{ type: 'text', text: last.content, ...mark }] };
  } else if (Array.isArray(last.content) && last.content.length > 0) {
    const blocks = (last.content as Array<Record<string, unknown>>).slice();
    // Thinking blocks can't carry a cache point: mark the last text or tool block.
    let i = blocks.length - 1;
    while (i >= 0 && !['text', 'tool_result', 'tool_use'].includes(String(blocks[i].type))) i--;
    if (i >= 0) {
      blocks[i] = { ...blocks[i], ...mark };
      out[out.length - 1] = { ...last, content: blocks };
    }
  }
  return out;
}

/** Whether the conversation is inside a tool loop: its last message returns tool results. */
function inToolLoop(messages: Array<{ content: unknown }>): boolean {
  const last = messages[messages.length - 1]?.content;
  return Array.isArray(last) && last.some(b => (b as { type?: string })?.type === 'tool_result');
}

/** The request body with prompt caching applied to its system prompt (and, inside a tool loop, its messages). */
export function withPromptCache(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages as Array<{ role: string; content: unknown }> : null;
  return {
    ...body,
    ...(typeof body.system === 'string' ? { system: cachedSystem(body.system) } : {}),
    ...(messages && inToolLoop(messages) ? { messages: withCachedHistory(messages) } : {}),
  };
}

export async function fetchClaudeMessages(
  body: Record<string, unknown>,
  apiKey: string,
  models: string[] = CHAT_MODELS,
): Promise<{ res: Response; model: string }> {
  let last: { res: Response; model: string } | null = null;
  for (const model of models) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ ...withPromptCache(body), model }),
    });
    if (res.ok) return { res, model };
    const modelUnavailable = res.status === 404 || (res.status === 400 && /model/i.test(await res.clone().text()));
    if (!modelUnavailable) return { res, model };
    last = { res, model };
  }
  return last!;
}
