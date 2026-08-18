import { NextRequest } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { buildChatContext } from '@/lib/services/chat-context';
import { calculateChatCreditCost, checkCredits, deductCredits } from '@/lib/middleware/billing';

export const maxDuration = 120;

// POST /api/missions/[id]/chat
// Streaming chat endpoint. Calls Anthropic directly for SSE streaming.
// Deducts credits proportionally after stream completes.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const { messages, sessionId, isFirstLoad } = await request.json() as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    sessionId?: string;
    isFirstLoad?: boolean;
  };

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages required' }), { status: 400 });
  }

  // Quick credit pre-check (2 credits minimum for a chat message)
  const creditCheck = await checkCredits(tenantId, 2);
  if (!creditCheck.allowed) {
    return new Response(
      JSON.stringify({ error: creditCheck.reason ?? 'Insufficient credits' }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Build context fresh each call
  const { systemPrompt } = await buildChatContext(missionId, tenantId, isFirstLoad ?? false);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'LLM not configured' }), { status: 500 });
  }

  // Keep last 20 messages to control context window
  const recentMessages = messages.slice(-20);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        // Call Anthropic streaming API directly
        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            stream: true,
            system: systemPrompt,
            messages: recentMessages,
          }),
        });

        if (!anthropicRes.ok) {
          const err = await anthropicRes.text();
          send({ type: 'error', message: 'AI service temporarily unavailable. Please try again.' });
          console.error('[chat] Anthropic error:', err);
          controller.close();
          return;
        }

        const reader = anthropicRes.body!.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let inputTokens = 0;
        let outputTokens = 0;
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines
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
                delta?: { type: string; text?: string };
                usage?: { input_tokens?: number; output_tokens?: number };
                message?: { usage?: { input_tokens?: number; output_tokens?: number } };
              };

              if (evt.type === 'message_start' && evt.message?.usage) {
                inputTokens = evt.message.usage.input_tokens ?? 0;
              }
              if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
                fullText += evt.delta.text;
                send({ type: 'delta', text: evt.delta.text });
              }
              if (evt.type === 'message_delta' && evt.usage) {
                outputTokens = evt.usage.output_tokens ?? 0;
              }
            } catch { /* malformed SSE line — skip */ }
          }
        }

        // Extract <action> block from full response
        const actionMatch = fullText.match(/<action>([\s\S]*?)<\/action>/);
        let actionPayload: Record<string, unknown> | null = null;
        let cleanText = fullText;
        if (actionMatch) {
          try {
            actionPayload = JSON.parse(actionMatch[1]);
            cleanText = fullText.replace(/<action>[\s\S]*?<\/action>/, '').trim();
          } catch { /* malformed action — ignore */ }
        }

        // Deduct credits proportionally (fire-and-forget, non-blocking)
        const credits = await calculateChatCreditCost(inputTokens, outputTokens, 'claude-sonnet-4-6');
        deductCredits(tenantId, credits, 'chat_message', {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          inputTokens,
          outputTokens,
        }).catch(console.error);

        // Persist messages to DB (fire-and-forget)
        const supabase = createServiceClient();
        const chatId = sessionId ?? await ensureSession(supabase, missionId, tenantId, recentMessages);

        // Save user message (last in array)
        const userMsg = recentMessages[recentMessages.length - 1];
        await supabase.from('mission_chat_messages').insert({
          chat_id: chatId,
          tenant_id: tenantId,
          role: userMsg.role,
          content: userMsg.content,
        }).then(() => {
          // Save assistant message
          supabase.from('mission_chat_messages').insert({
            chat_id: chatId,
            tenant_id: tenantId,
            role: 'assistant',
            content: cleanText,
            action_payload: actionPayload,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            credits_deducted: credits,
          }).catch(console.error);
          // Update session timestamp
          supabase.from('mission_chats').update({ updated_at: new Date().toISOString() })
            .eq('id', chatId).catch(console.error);
        }).catch(console.error);

        // Send final done event with action and metadata
        send({
          type: 'done',
          credits,
          inputTokens,
          outputTokens,
          sessionId: chatId,
          cleanText,
          action: actionPayload,
        });

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

// Create a new chat session if no sessionId provided, or return the resolved ID
async function ensureSession(
  supabase: ReturnType<typeof createServiceClient>,
  missionId: string,
  tenantId: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  // Auto-title from the first user message (first 8 words)
  const firstUser = messages.find(m => m.role === 'user')?.content ?? '';
  const words = firstUser.trim().split(/\s+/).slice(0, 8).join(' ');
  const title = words.length > 0 ? (words.length < firstUser.trim().length ? words + '…' : words) : 'New Chat';

  const { data, error } = await supabase
    .from('mission_chats')
    .insert({ mission_id: missionId, tenant_id: tenantId, title })
    .select('id')
    .single();

  if (error || !data) throw new Error('Could not create chat session');
  return data.id as string;
}
