import { NextRequest } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { buildChatContext } from '@/lib/services/chat-context';
import { calculateChatCreditCost, checkCredits, deductCredits } from '@/lib/middleware/billing';

export const maxDuration = 120;

// ── Tool definitions exposed to Claude ────────────────────────────────────
const CHAT_TOOLS = [
  {
    name: 'get_run_errors',
    description:
      'Read the actual error messages and full details from the most recent failed run of this mission. Returns specific error text, which agents failed, and what was completed before the failure. Call this whenever the user asks why the mission failed, what went wrong, or how to fix it.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'execute_composio_action',
    description:
      'Execute a real action on a connected service on behalf of the user — check if a Google Sheet exists, create a spreadsheet, read emails, post to Slack, search Drive, etc. Use the exact Composio action slug (e.g. GOOGLESHEETS_CREATE_SPREADSHEET, GOOGLESHEETS_BATCH_GET, GMAIL_SEND_EMAIL). Only call this for providers the user has actually connected.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action_slug: {
          type: 'string' as const,
          description:
            'Exact Composio action slug in ALL_CAPS_UNDERSCORES format (e.g. GOOGLESHEETS_CREATE_SPREADSHEET)',
        },
        arguments: {
          type: 'object' as const,
          description: 'Arguments required by the action as key-value pairs',
        },
        provider: {
          type: 'string' as const,
          description:
            'Provider key (e.g. "google", "github", "slack") — must match a connected provider',
        },
      },
      required: ['action_slug', 'arguments', 'provider'] as string[],
    },
  },
];

const TOOL_LABELS: Record<string, string> = {
  get_run_errors: 'Reading error logs…',
  execute_composio_action: 'Executing action…',
};

// ── Tool execution ─────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  missionId: string,
  tenantId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ content: string; summary: string }> {

  // ── get_run_errors ──────────────────────────────────────────────────────
  if (name === 'get_run_errors') {
    const { data: latestRun } = await supabase
      .from('mission_runs')
      .select('id, run_number, status, started_at, agents_failed, agents_done, agents_total, summary')
      .eq('mission_id', missionId)
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRun) {
      return { content: 'No runs found for this mission yet.', summary: 'No runs found' };
    }

    const runMeta = `Run #${latestRun.run_number} — status: ${latestRun.status}, started: ${latestRun.started_at}\nAgents: ${latestRun.agents_done ?? 0} completed, ${latestRun.agents_failed ?? 0} failed out of ${latestRun.agents_total ?? 0} total`;

    // Get error events for this specific run
    const { data: errorEvents } = await supabase
      .from('events')
      .select('event_type, payload, created_at')
      .eq('run_id', latestRun.id)
      .eq('tenant_id', tenantId)
      .in('event_type', ['mission.failed', 'agent.failed', 'agent.error', 'circuit_breaker.triggered'])
      .order('created_at', { ascending: true });

    const errors = (errorEvents ?? [])
      .map(e => {
        const msg = e.payload?.error ?? e.payload?.message ?? e.payload?.reason ?? JSON.stringify(e.payload ?? {});
        return `[${e.event_type}] ${msg}`;
      })
      .join('\n');

    // Get run summary if it exists (generated at completion)
    const summary = latestRun.summary ? `\nRun summary: ${latestRun.summary}` : '';

    const content = [
      runMeta,
      errors ? `\nErrors detected:\n${errors}` : '\n(No specific error events found — the run may have timed out or been interrupted externally)',
      summary,
    ].join('');

    return {
      content,
      summary: `${errorEvents?.length ?? 0} error(s) found in Run #${latestRun.run_number}`,
    };
  }

  // ── execute_composio_action ─────────────────────────────────────────────
  if (name === 'execute_composio_action') {
    const actionSlug = input.action_slug as string;
    const args = (input.arguments ?? {}) as Record<string, unknown>;

    if (!actionSlug) {
      return { content: 'Missing action_slug parameter.', summary: 'Invalid parameters' };
    }

    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      return { content: 'Service integration not configured on this platform.', summary: 'Not configured' };
    }

    try {
      const { default: Composio } = await import('@composio/client');
      const client = new Composio({ apiKey });

      const result = await (client.tools as any).execute(actionSlug, {
        user_id: tenantId,
        arguments: args,
      });

      const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const truncated =
        resultStr.length > 4000 ? resultStr.slice(0, 4000) + '\n…(truncated)' : resultStr;

      return {
        content: `Action "${actionSlug}" completed.\n\nResult:\n${truncated}`,
        summary: `${actionSlug} succeeded`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: `Action "${actionSlug}" failed: ${msg}`,
        summary: `${actionSlug} failed`,
      };
    }
  }

  return { content: `Unknown tool: ${name}`, summary: 'Unknown tool' };
}

// ── Streaming parser ───────────────────────────────────────────────────────

interface ContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  inputJson?: string;
}

interface StreamResult {
  textContent: string;
  contentBlocks: ContentBlock[];
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
}

async function parseAnthropicStream(
  response: Response,
  onTextDelta: (text: string) => void
): Promise<StreamResult> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const contentBlocks: ContentBlock[] = [];
  let stopReason = 'end_turn';
  let inputTokens = 0;
  let outputTokens = 0;
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;

      try {
        const evt = JSON.parse(raw) as {
          type: string;
          index?: number;
          content_block?: { type: string; id?: string; name?: string };
          delta?: {
            type: string;
            text?: string;
            partial_json?: string;
            stop_reason?: string;
          };
          usage?: { output_tokens?: number };
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        };

        if (evt.type === 'message_start' && evt.message?.usage) {
          inputTokens = evt.message.usage.input_tokens ?? 0;
        }

        if (evt.type === 'content_block_start' && evt.content_block) {
          const idx = evt.index ?? contentBlocks.length;
          const cb = evt.content_block;
          if (cb.type === 'text') {
            contentBlocks[idx] = { type: 'text', text: '' };
          } else if (cb.type === 'tool_use') {
            contentBlocks[idx] = { type: 'tool_use', id: cb.id, name: cb.name, inputJson: '' };
          }
        }

        if (evt.type === 'content_block_delta' && evt.delta) {
          const idx = evt.index ?? contentBlocks.length - 1;
          const block = contentBlocks[idx];
          if (!block) continue;

          if (evt.delta.type === 'text_delta' && evt.delta.text && block.type === 'text') {
            block.text = (block.text ?? '') + evt.delta.text;
            fullText += evt.delta.text;
            onTextDelta(evt.delta.text);
          }

          if (
            evt.delta.type === 'input_json_delta' &&
            evt.delta.partial_json &&
            block.type === 'tool_use'
          ) {
            block.inputJson = (block.inputJson ?? '') + evt.delta.partial_json;
          }
        }

        if (evt.type === 'message_delta') {
          stopReason = (evt.delta as Record<string, unknown>)?.stop_reason as string ?? stopReason;
          outputTokens = evt.usage?.output_tokens ?? outputTokens;
        }
      } catch {
        /* skip malformed SSE lines */
      }
    }
  }

  return { textContent: fullText, contentBlocks, stopReason, inputTokens, outputTokens };
}

// ── Agentic chat loop ──────────────────────────────────────────────────────

async function runChatLoop(
  systemPrompt: string,
  initialMessages: Array<{ role: string; content: unknown }>,
  apiKey: string,
  missionId: string,
  tenantId: string,
  supabase: ReturnType<typeof createServiceClient>,
  send: (obj: Record<string, unknown>) => void
): Promise<{ fullText: string; inputTokens: number; outputTokens: number }> {
  const messages = [...initialMessages];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let fullText = '';
  const MAX_TOOL_ROUNDS = 5;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        stream: true,
        system: systemPrompt,
        tools: CHAT_TOOLS,
        messages,
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      console.error('[chat] Anthropic error:', err);
      send({ type: 'error', message: 'AI service temporarily unavailable. Please try again.' });
      break;
    }

    const { textContent, contentBlocks, stopReason, inputTokens, outputTokens } =
      await parseAnthropicStream(anthropicRes, (text) => send({ type: 'delta', text }));

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    if (textContent) fullText += textContent;

    // Build assistant content blocks for history
    const assistantContent: unknown[] = [];
    for (const block of contentBlocks) {
      if (block.type === 'text' && block.text) {
        assistantContent.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use' && block.id) {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = JSON.parse(block.inputJson ?? '{}');
        } catch { /* leave empty */ }
        assistantContent.push({ type: 'tool_use', id: block.id, name: block.name, input: parsedInput });
      }
    }

    const toolBlocks = contentBlocks.filter(b => b.type === 'tool_use' && b.id && b.name);
    if (stopReason !== 'tool_use' || toolBlocks.length === 0) break;

    // Execute each tool and collect results
    const toolResults: unknown[] = [];
    for (const block of toolBlocks) {
      const label = TOOL_LABELS[block.name!] ?? `Running ${block.name}…`;
      send({ type: 'tool_status', name: block.name, status: 'running', label });

      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(block.inputJson ?? '{}');
      } catch { /* leave empty */ }

      const result = await executeTool(block.name!, parsedInput, missionId, tenantId, supabase);
      send({ type: 'tool_status', name: block.name, status: 'done', summary: result.summary });

      toolResults.push({ type: 'tool_result', tool_use_id: block.id!, content: result.content });
    }

    // Append assistant + tool results for the next round
    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({ role: 'user', content: toolResults });
  }

  return { fullText, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

// ── Route handler ──────────────────────────────────────────────────────────

// POST /api/missions/[id]/chat
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const { messages, sessionId, isFirstLoad } = (await request.json()) as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    sessionId?: string;
    isFirstLoad?: boolean;
  };

  const encoder = new TextEncoder();

  // First-load probe: emit proactive alert if any, no LLM call, no credits
  if (isFirstLoad && (!messages || messages.length === 0)) {
    const { proactiveAlert } = await buildChatContext(missionId, tenantId, true);
    const stream = new ReadableStream({
      start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        if (proactiveAlert) send({ type: 'proactive_alert', proactiveAlert });
        send({ type: 'done' });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages required' }), { status: 400 });
  }

  const creditCheck = await checkCredits(tenantId, 2);
  if (!creditCheck.allowed) {
    return new Response(JSON.stringify({ error: creditCheck.reason ?? 'Insufficient credits' }), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { systemPrompt } = await buildChatContext(missionId, tenantId, isFirstLoad ?? false);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'LLM not configured' }), { status: 500 });
  }

  const recentMessages = messages.slice(-20);
  const supabase = createServiceClient();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const { fullText, inputTokens, outputTokens } = await runChatLoop(
          systemPrompt,
          recentMessages,
          apiKey,
          missionId,
          tenantId,
          supabase,
          send
        );

        // Extract <action> block from the complete text
        const actionMatch = fullText.match(/<action>([\s\S]*?)<\/action>/);
        let actionPayload: Record<string, unknown> | null = null;
        let cleanText = fullText;
        if (actionMatch) {
          try {
            actionPayload = JSON.parse(actionMatch[1]);
            cleanText = fullText.replace(/<action>[\s\S]*?<\/action>/, '').trim();
          } catch { /* malformed action — ignore */ }
        }

        // Deduct credits (fire-and-forget)
        const credits = await calculateChatCreditCost(inputTokens, outputTokens, 'claude-sonnet-4-6');
        deductCredits(tenantId, credits, 'chat_message', {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          inputTokens,
          outputTokens,
        }).catch(console.error);

        // Persist chat messages (fire-and-forget)
        const chatId =
          sessionId ?? (await ensureSession(supabase, missionId, tenantId, recentMessages));
        const userMsg = recentMessages[recentMessages.length - 1];
        ;(async () => {
          const { error: ue } = await supabase.from('mission_chat_messages').insert({
            chat_id: chatId,
            tenant_id: tenantId,
            role: userMsg.role,
            content: userMsg.content,
          });
          if (ue) { console.error('[chat/persist user]', ue); return; }
          await supabase.from('mission_chat_messages').insert({
            chat_id: chatId,
            tenant_id: tenantId,
            role: 'assistant',
            content: cleanText,
            action_payload: actionPayload,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            credits_deducted: credits,
          });
          await supabase
            .from('mission_chats')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', chatId);
        })().catch(console.error);

        send({ type: 'done', credits, inputTokens, outputTokens, sessionId: chatId, cleanText, action: actionPayload });
      } catch (err) {
        console.error('[chat/stream]', err);
        send({ type: 'error', message: 'Something went wrong. Please try again.' });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function ensureSession(
  supabase: ReturnType<typeof createServiceClient>,
  missionId: string,
  tenantId: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const firstUser = messages.find(m => m.role === 'user')?.content ?? '';
  const words = firstUser.trim().split(/\s+/).slice(0, 8).join(' ');
  const title =
    words.length > 0 ? (words.length < firstUser.trim().length ? words + '…' : words) : 'New Chat';

  const { data, error } = await supabase
    .from('mission_chats')
    .insert({ mission_id: missionId, tenant_id: tenantId, title })
    .select('id')
    .single();

  if (error || !data) throw new Error('Could not create chat session');
  return data.id as string;
}
