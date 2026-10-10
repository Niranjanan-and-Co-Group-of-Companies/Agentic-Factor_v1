import { CHAT_MODELS, fetchClaudeMessages } from '@/lib/services/claude-chat';
import { NextRequest } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { buildChatContext } from '@/lib/services/chat-context';
import { calculateChatCreditCost, checkCredits, deductCredits } from '@/lib/middleware/billing';
import { retrieveRelevantChunks, listUploadedDocuments } from '@/lib/services/rag-retrieval';
import { detectApiKey, redactKey, providerLabel } from '@/lib/services/apikey-detector';
import { verifyApiKey } from '@/lib/services/apikey-verifier';
import { loadMissionTools, refreshMissionTools, describeToolCall, type AnthropicTool, type ToolMeta } from '@/lib/services/tool-registry';
import { writeEpisode } from '@/lib/services/agent-memory';
import { inngest } from '@/lib/inngest/client';

export const maxDuration = 300; // 5-minute safety buffer for the first LLM streaming call

// ── Streaming parser (for the first Vercel LLM call only) ─────────────────

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  inputJson?: string;
  raw?: Record<string, unknown>;
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
          content_block?: { type: string; id?: string; name?: string; [k: string]: unknown };
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
          // Any other block (e.g. thinking from newer models) is kept as sent — it must go back unchanged
          // on the next tool round. Dropping it left a gap that crashed on block.type.
          else contentBlocks[idx] = { type: cb.type, raw: { ...cb } };
        }
        if (evt.type === 'content_block_delta' && evt.delta) {
          const idx = evt.index ?? contentBlocks.length - 1;
          const block = contentBlocks[idx];
          if (!block) continue;
          if (block.raw && evt.delta.type === 'thinking_delta') block.raw.thinking = String(block.raw.thinking ?? '') + String((evt.delta as Record<string, unknown>).thinking ?? '');
          if (block.raw && evt.delta.type === 'signature_delta') block.raw.signature = (evt.delta as Record<string, unknown>).signature;
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

  return { textContent: fullText, contentBlocks: contentBlocks.filter(Boolean), stopReason, inputTokens, outputTokens };
}

// Strips ALL <action>...</action> blocks from text — used server-side to
// sanitize cleanText before storage and to scrub incoming message history.
function stripAllActionTags(text: string): string {
  return text
    .replace(/<action>[\s\S]*?<\/action>/g, '')
    .replace(/<action>[\s\S]*$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

  // Credit pre-flight — need at least 10 credits (one LLM call + one tool round)
  const creditCheck = await checkCredits(tenantId, 10);
  if (!creditCheck.allowed) {
    return new Response(JSON.stringify({ error: creditCheck.reason ?? 'Insufficient credits' }), {
      status: 402, headers: { 'Content-Type': 'application/json' },
    });
  }

  let { systemPrompt, connectedProviders } = await buildChatContext(missionId, tenantId, isFirstLoad ?? false);

  // ── API key paste detection ──────────────────────────────────────────────
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

  // ── RAG: inject relevant uploaded document context ───────────────────────
  const userQuery = lastUserMsg?.content ?? '';
  const [ragContext, docList] = await Promise.all([
    retrieveRelevantChunks(tenantId, missionId, userQuery),
    listUploadedDocuments(tenantId, missionId),
  ]);
  if (docList) systemPrompt += `\n\n${docList}`;
  if (ragContext) systemPrompt += `\n\n${ragContext}`;

  // ── Dynamic tool loading ─────────────────────────────────────────────────
  const { tools, toolMeta, needsRefresh } = await loadMissionTools(tenantId, missionId, connectedProviders);

  if (needsRefresh && connectedProviders.length > 0) {
    refreshMissionTools(tenantId, missionId, connectedProviders).catch(err =>
      console.error('[chat] Tool refresh error:', err)
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'LLM not configured' }), { status: 500 });
  }

  let model = CHAT_MODELS[0];
  // Sanitize history: strip action tags from prior assistant messages so they
  // never appear as raw JSON in Claude's context window.
  const recentMessages = messages.slice(-20).map(m => ({
    role: m.role,
    content: m.role === 'assistant' ? stripAllActionTags(m.content) : m.content,
  }));
  const supabase = createServiceClient();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        // ── First (and only Vercel) LLM call — streaming ─────────────────
        const { res: anthropicRes, model: servedModel } = await fetchClaudeMessages({
          max_tokens: 4096,
          stream: true,
          system: systemPrompt,
          tools,
          messages: recentMessages,
        }, apiKey);
        model = servedModel;

        let streamed: Awaited<ReturnType<typeof parseAnthropicStream>>;
        if (!anthropicRes.ok) {
          const err = await anthropicRes.text();
          console.error('[chat] Anthropic error:', err);
          // detail is not shown in the chat UI; it carries Anthropic's reason (e.g. an invalid tool schema)
          let reason = err.slice(0, 300);
          try { reason = (JSON.parse(err) as { error?: { message?: string } }).error?.message?.slice(0, 300) ?? reason; } catch { /* raw */ }
          // Answer through the multi-provider router instead of failing (e.g. Anthropic balance exhausted);
          // tools are unavailable in this mode but action tags in the text still work.
          try {
            const { callLLM } = await import('@/lib/services/llm-router');
            const fallback = await callLLM(
              [
                { role: 'system', content: systemPrompt },
                ...recentMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: String(m.content) })),
              ],
              { tier: 1, jsonMode: false, maxTokens: 4096, temperature: 0.5 },
            );
            send({ type: 'delta', text: fallback.content });
            streamed = { textContent: fallback.content, contentBlocks: [], stopReason: 'end_turn', inputTokens: fallback.inputTokens ?? 0, outputTokens: fallback.outputTokens ?? 0 };
          } catch (fallbackErr) {
            console.error('[chat] Router fallback failed:', fallbackErr);
            send({ type: 'error', message: 'AI service temporarily unavailable. Please try again.', detail: `${anthropicRes.status}: ${reason}` });
            controller.close();
            return;
          }
        } else {
          streamed = await parseAnthropicStream(anthropicRes, text => send({ type: 'delta', text }));
        }

        const { textContent, contentBlocks, stopReason, inputTokens, outputTokens } = streamed;

        const toolBlocks = contentBlocks.filter(b => b.type === 'tool_use' && b.id && b.name);

        // ── Simple text response — no tools needed ────────────────────────
        if (stopReason !== 'tool_use' || toolBlocks.length === 0) {
          // Parse ALL action tags — take the first valid one as the card payload.
          // Strip ALL of them from cleanText so none leak into stored history.
          const allActionMatches = [...textContent.matchAll(/<action>([\s\S]*?)<\/action>/g)];
          let actionPayload: Record<string, unknown> | null = null;
          for (const m of allActionMatches) {
            try { actionPayload = JSON.parse(m[1]); break; } catch { /* skip malformed */ }
          }
          const cleanText = stripAllActionTags(textContent);

          const credits = await calculateChatCreditCost(inputTokens, outputTokens, model);
          try {
            await deductCredits(tenantId, credits, 'chat_message', {
              provider: 'anthropic', model, inputTokens, outputTokens,
            });
          } catch (deductErr) {
            console.error('[Chat] Credit deduction failed:', deductErr);
            // Non-fatal for already-streamed response, but log for monitoring
          }

          const chatId = sessionId ?? (await ensureSession(supabase, missionId, tenantId, recentMessages));
          const userMsg = recentMessages[recentMessages.length - 1];

          // Awaited before the stream closes: after controller.close() the serverless function can be
          // frozen, which silently dropped the assistant reply (and its Apply action) from history.
          await (async () => {
            await supabase.from('mission_chat_messages').insert({ chat_id: chatId, tenant_id: tenantId, role: userMsg.role, content: userMsg.content });
            await supabase.from('mission_chat_messages').insert({
              chat_id: chatId, tenant_id: tenantId, role: 'assistant', content: cleanText,
              action_payload: actionPayload, input_tokens: inputTokens, output_tokens: outputTokens, credits_deducted: credits,
            });
            await supabase.from('mission_chats').update({ updated_at: new Date().toISOString() }).eq('id', chatId);
          })().catch(console.error);
          const allMsgs = recentMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: String(m.content) }));
          allMsgs.push({ role: 'assistant', content: cleanText });
          writeEpisode(tenantId, missionId, allMsgs, []).catch(console.error);

          send({ type: 'done', credits, inputTokens, outputTokens, sessionId: chatId, cleanText, action: actionPayload });
          controller.close();
          return;
        }

        // ── Tool use detected — hand off to Inngest ───────────────────────
        const chatId = sessionId ?? (await ensureSession(supabase, missionId, tenantId, recentMessages));
        const executionId = crypto.randomUUID();

        // Serialize contentBlocks for the Inngest event (parse inputJson → input)
        const firstAssistantContent = contentBlocks
          .filter(b => b.raw || (b.type === 'text' && b.text) || (b.type === 'tool_use' && b.id))
          .map(b => {
            if (b.raw) return b.raw as unknown as { type: 'text'; text: string };
            if (b.type === 'text') return { type: 'text', text: b.text! };
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(b.inputJson ?? '{}'); } catch { /* leave empty */ }
            return { type: 'tool_use', id: b.id!, name: b.name!, input };
          });

        // Deduct planning call credits
        try {
          const planningCost = await calculateChatCreditCost(inputTokens, outputTokens, model);
          await deductCredits(tenantId, planningCost, 'chat_planning', { provider: 'anthropic', model, inputTokens, outputTokens });
        } catch (deductErr) {
          console.error('[Chat] Planning credit deduction failed:', deductErr);
        }

        // Fire Inngest — this is where all tool execution happens
        await inngest.send({
          name: 'chat.agent.execute',
          data: {
            tenantId,
            missionId,
            chatId,
            executionId,
            recentMessages: recentMessages.map(m => ({ role: m.role, content: m.content })),
            firstAssistantContent,
            planningText: textContent,
            connectedProviders,
            model,
          },
        });

        // Tell the frontend to switch to Realtime mode
        send({ type: 'agent_queued', executionId, sessionId: chatId });
        controller.close();

      } catch (err) {
        console.error('[chat/stream]', err);
        send({ type: 'error', message: 'Something went wrong. Please try again.' });
        controller.close();
      }
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
