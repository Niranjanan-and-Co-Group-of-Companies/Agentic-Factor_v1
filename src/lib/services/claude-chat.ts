/**
 * Chat (Command Center, mission chat) streams straight from the Anthropic Messages API. The latest
 * Claude model leads; if this account cannot use it, the next one answers instead of the chat
 * dropping to the tool-less router fallback.
 */
export const CHAT_MODELS = ['claude-sonnet-5', 'claude-sonnet-4-6'];

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
      body: JSON.stringify({ ...body, model }),
    });
    if (res.ok) return { res, model };
    const modelUnavailable = res.status === 404 || (res.status === 400 && /model/i.test(await res.clone().text()));
    if (!modelUnavailable) return { res, model };
    last = { res, model };
  }
  return last!;
}
