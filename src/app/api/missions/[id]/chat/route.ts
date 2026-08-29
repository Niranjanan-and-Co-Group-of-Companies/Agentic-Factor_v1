import { NextRequest } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { buildChatContext } from '@/lib/services/chat-context';
import { calculateChatCreditCost, checkCredits, deductCredits } from '@/lib/middleware/billing';
import { retrieveRelevantChunks, listUploadedDocuments } from '@/lib/services/rag-retrieval';
import { detectApiKey, redactKey, providerLabel } from '@/lib/services/apikey-detector';
import { verifyApiKey } from '@/lib/services/apikey-verifier';
import { loadMissionTools, refreshMissionTools, executeTool, describeToolCall, type AnthropicTool, type ToolMeta } from '@/lib/services/tool-registry';
import { writeEpisode } from '@/lib/services/agent-memory';

export const maxDuration = 300; // 5 minutes — agentic loops with many tool calls need time

const MAX_TOOL_ROUNDS = 15;
const MAX_TOKENS_PER_LOOP = 40_000; // safety: stop looping if token budget exhausted
const TOOL_TIMEOUT_MS = 30_000;     // per-tool-call timeout

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
          delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
          usage?: { output_tokens?: number };
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        };

        if (evt.type === 'message_start' && evt.message?.usage) {
          inputTokens = evt.message.usage.input_tokens ?? 0;
        }
        if (evt.type === 'content_block_start' && evt.content_block) {
          const idx = evt.index ?? contentBlocks.length;
          const cb = evt.content_block;
          if (cb.type === 'text') contentBlocks[idx] = { type: 'text', text: '' };
          else if (cb.type === 'tool_use') contentBlocks[idx] = { type: 'tool_use', id: cb.id, name: cb.name, inputJson: '' };
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
          if (evt.delta.type === 'input_json_delta' && evt.delta.partial_json && block.type === 'tool_use') {
            block.inputJson = (block.inputJson ?? '') + evt.delta.partial_json;
          }
        }
        if (evt.type === 'message_delta') {
          stopReason = (evt.delta as Record<string, unknown>)?.stop_reason as string ?? stopReason;
          outputTokens = evt.usage?.output_tokens ?? outputTokens;
        }
      } catch { /* skip malformed SSE lines */ }
    }
  }

  return { textContent: fullText, contentBlocks, stopReason, inputTokens, outputTokens };
}

// ── Agentic chat loop ──────────────────────────────────────────────────────

async function runChatLoop(params: {
  systemPrompt: string;
  initialMessages: Array<{ role: string; content: unknown }>;
  apiKey: string;
  missionId: string;
  tenantId: string;
  supabase: ReturnType<typeof createServiceClient>;
  tools: AnthropicTool[];
  toolMeta: Map<string, ToolMeta>;
  send: (obj: Record<string, unknown>) => void;
}): Promise<{ fullText: string; inputTokens: number; outputTokens: number; toolsUsed: string[] }> {
  const { systemPrompt, initialMessages, apiKey, missionId, tenantId, supabase, tools, toolMeta, send } = params;
  const messages = [...initialMessages];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let fullText = '';
  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Token budget guard — prevent runaway loops
    if (totalInputTokens + totalOutputTokens > MAX_TOKENS_PER_LOOP) {
      send({ type: 'delta', text: '\n\n*(Reached maximum context — wrapping up.)*' });
      break;
    }

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
        tools,
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
      await parseAnthropicStream(anthropicRes, text => send({ type: 'delta', text }));

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    if (textContent) fullText += textContent;

    // Build assistant message for conversation history
    const assistantContent: unknown[] = [];
    for (const block of contentBlocks) {
      if (block.type === 'text' && block.text) {
        assistantContent.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use' && block.id) {
        let parsedInput: Record<string, unknown> = {};
        try { parsedInput = JSON.parse(block.inputJson ?? '{}'); } catch { /* leave empty */ }
        assistantContent.push({ type: 'tool_use', id: block.id, name: block.name, input: parsedInput });
      }
    }

    const toolBlocks = contentBlocks.filter(b => b.type === 'tool_use' && b.id && b.name);
    if (stopReason !== 'tool_use' || toolBlocks.length === 0) break;

    // Execute all tool calls in this round
    const toolResults: unknown[] = [];
    for (const block of toolBlocks) {
      const meta = toolMeta.get(block.name!);
      const providerSlug = meta?.providerSlug ?? 'system';
      const logoUrl = meta?.logoUrl ?? null;
      const displayName = meta?.displayName ?? block.name!;

      let parsedInput: Record<string, unknown> = {};
      try { parsedInput = JSON.parse(block.inputJson ?? '{}'); } catch { /* leave empty */ }

      const label = describeToolCall(block.name!, parsedInput);

      // Emit running event with full metadata
      send({
        type: 'tool_status',
        name: block.name,
        provider: providerSlug,
        displayName,
        status: 'running',
        label,
        logoUrl,
      });

      toolsUsed.push(block.name!);

      let result: { content: string; summary: string };
      try {
        // Per-tool timeout via Promise.race
        result = await Promise.race([
          executeTool(block.name!, parsedInput, tenantId, missionId, supabase),
          new Promise<{ content: string; summary: string }>((_, reject) =>
            setTimeout(() => reject(new Error('Tool timed out')), TOOL_TIMEOUT_MS)
          ),
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result = { content: `Tool "${block.name}" timed out: ${msg}`, summary: `${block.name} timed out` };
      }

      send({
        type: 'tool_status',
        name: block.name,
        provider: providerSlug,
        displayName,
        status: result.summary.includes('failed') || result.summary.includes('timed out') ? 'error' : 'done',
        summary: result.summary,
        logoUrl,
      });

      toolResults.push({ type: 'tool_result', tool_use_id: block.id!, content: result.content });
    }

    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({ role: 'user', content: toolResults });
  }

  return { fullText, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, toolsUsed };
}

// ── Route handler ──────────────────────────────────────────────────────────

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

  // First-load probe — emit proactive alert only, no LLM call
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
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });
  }

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages required' }), { status: 400 });
  }

  const creditCheck = await checkCredits(tenantId, 2);
  if (!creditCheck.allowed) {
    return new Response(JSON.stringify({ error: creditCheck.reason ?? 'Insufficient credits' }), {
      status: 402, headers: { 'Content-Type': 'application/json' },
    });
  }

  let { systemPrompt, connectedProviders } = await buildChatContext(missionId, tenantId, isFirstLoad ?? false);

  // ── API key paste detection ──────────────────────────────────────────
  const lastUserMsg = messages[messages.length - 1];
  if (lastUserMsg?.role === 'user') {
    const detectedKey = detectApiKey(lastUserMsg.content);
    if (detectedKey) {
      const verifyResult = await verifyApiKey(detectedKey.provider, { apiKey: detectedKey.key });
      const label = providerLabel(detectedKey.provider);
      const enc2 = new TextEncoder();
      if (verifyResult.verified) {
        const supabaseKv = createServiceClient();
        await supabaseKv.from('tenant_permissions').upsert(
          { tenant_id: tenantId, provider: detectedKey.provider, access_token: detectedKey.key, refresh_token: null, expires_at: null, scopes: ['apikey'], updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,provider' }
        );
        const info = verifyResult.accountInfo ? ` ${verifyResult.accountInfo}.` : '';
        const reply = `Your ${label} key is now connected and ready to use.${info}`;
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(enc2.encode(`data: ${JSON.stringify({ type: 'delta', text: reply })}\n\n`));
            c.enqueue(enc2.encode(`data: ${JSON.stringify({ type: 'done', cleanText: reply, action: { type: 'key_connected', provider: detectedKey.provider, accountInfo: verifyResult.accountInfo } })}\n\n`));
            c.close();
          },
        });
        lastUserMsg.content = redactKey(lastUserMsg.content, detectedKey);
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
      } else {
        const reply = `That doesn't look like a valid ${label} key — ${verifyResult.error ?? 'please check and try again'}.`;
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(enc2.encode(`data: ${JSON.stringify({ type: 'delta', text: reply })}\n\n`));
            c.enqueue(enc2.encode(`data: ${JSON.stringify({ type: 'done', cleanText: reply, action: null })}\n\n`));
            c.close();
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
      }
    }
  }

  // ── RAG: inject relevant uploaded document context ───────────────────
  const userQuery = lastUserMsg?.content ?? '';
  const [ragContext, docList] = await Promise.all([
    retrieveRelevantChunks(tenantId, missionId, userQuery),
    listUploadedDocuments(tenantId, missionId),
  ]);
  if (docList) systemPrompt += `\n\n${docList}`;
  if (ragContext) systemPrompt += `\n\n${ragContext}`;

  // ── Dynamic tool loading ─────────────────────────────────────────────
  const { tools, toolMeta, needsRefresh } = await loadMissionTools(tenantId, missionId, connectedProviders);

  // If schemas are stale/missing, refresh in background for next call
  if (needsRefresh && connectedProviders.length > 0) {
    refreshMissionTools(tenantId, missionId, connectedProviders).catch(err =>
      console.error('[chat] Tool refresh error:', err)
    );
  }

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
        const { fullText, inputTokens, outputTokens, toolsUsed } = await runChatLoop({
          systemPrompt,
          initialMessages: recentMessages,
          apiKey,
          missionId,
          tenantId,
          supabase,
          tools,
          toolMeta,
          send,
        });

        // Extract <action> block
        const actionMatch = fullText.match(/<action>([\s\S]*?)<\/action>/);
        let actionPayload: Record<string, unknown> | null = null;
        let cleanText = fullText;
        if (actionMatch) {
          try {
            actionPayload = JSON.parse(actionMatch[1]);
            cleanText = fullText.replace(/<action>[\s\S]*?<\/action>/, '').trim();
          } catch { /* malformed — ignore */ }
        }

        // Deduct credits
        const credits = await calculateChatCreditCost(inputTokens, outputTokens, 'claude-sonnet-4-6');
        deductCredits(tenantId, credits, 'chat_message', {
          provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens, outputTokens,
        }).catch(console.error);

        // Persist messages + write episode memory (all fire-and-forget)
        const chatId = sessionId ?? (await ensureSession(supabase, missionId, tenantId, recentMessages));
        const userMsg = recentMessages[recentMessages.length - 1];

        ;(async () => {
          const { error: ue } = await supabase.from('mission_chat_messages').insert({
            chat_id: chatId, tenant_id: tenantId, role: userMsg.role, content: userMsg.content,
          });
          if (ue) { console.error('[chat/persist user]', ue); return; }

          await supabase.from('mission_chat_messages').insert({
            chat_id: chatId, tenant_id: tenantId,
            role: 'assistant', content: cleanText,
            action_payload: actionPayload,
            input_tokens: inputTokens, output_tokens: outputTokens, credits_deducted: credits,
          });

          await supabase.from('mission_chats').update({ updated_at: new Date().toISOString() }).eq('id', chatId);

          // Write episode memory in background (extract + store after session)
          const allMsgs = recentMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: String(m.content) }));
          allMsgs.push({ role: 'assistant', content: cleanText });
          writeEpisode(tenantId, missionId, allMsgs, toolsUsed).catch(console.error);
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
  messages: Array<{ role: string; content: unknown }>
): Promise<string> {
  const firstUser = messages.find(m => m.role === 'user')?.content ?? '';
  const words = String(firstUser).trim().split(/\s+/).slice(0, 8).join(' ');
  const title = words.length > 0
    ? (words.length < String(firstUser).trim().length ? words + '…' : words)
    : 'New Chat';

  const { data, error } = await supabase
    .from('mission_chats')
    .insert({ mission_id: missionId, tenant_id: tenantId, title })
    .select('id')
    .single();

  if (error || !data) throw new Error('Could not create chat session');
  return data.id as string;
}
