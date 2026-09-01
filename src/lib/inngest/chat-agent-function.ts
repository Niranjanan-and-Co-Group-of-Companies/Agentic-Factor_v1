/* eslint-disable @typescript-eslint/no-explicit-any */
import { inngest } from './client';
import { createServiceClient } from '@/lib/supabase/server';
import type { ToolMeta } from '@/lib/services/tool-registry';

// ─────────────────────────────────────────────────────────────
// executeChatAgent — Inngest function for agentic chat execution
//
// Called by the Vercel /api/missions/[id]/chat route when the
// first LLM planning call detects tool_use. Vercel handles the
// fast planning response (already streamed to the browser).
// This function handles all tool execution rounds with no timeout
// pressure. Tool status events go to agent_execution_events via
// Supabase (frontend subscribes via Realtime). Final message is
// persisted to mission_chat_messages and a 'agent_completed'
// event signals the frontend to display it.
// ─────────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 50;
const TOOL_TIMEOUT_MS = 60_000;

interface SerializedContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ChatAgentEvent {
  data: {
    tenantId: string;
    missionId: string;
    chatId: string;
    executionId: string;        // UUID for Realtime channel scoping
    recentMessages: Array<{ role: string; content: string }>;
    firstAssistantContent: SerializedContentBlock[];
    planningText: string;       // text already streamed to the user in Vercel
    connectedProviders: string[];
    model: string;
  };
}

export const executeChatAgent = inngest.createFunction(
  {
    id: 'execute-chat-agent',
    name: 'Execute Chat Agent (Agentic Loop)',
    retries: 0, // Never retry chat — surface the error clearly
    triggers: [{ event: 'chat.agent.execute' }],
  },
  async ({ event, step }: { event: ChatAgentEvent; step: any }) => {
    const { tenantId, missionId, chatId, executionId, recentMessages, firstAssistantContent, planningText, connectedProviders, model } = event.data;
    const supabaseService = createServiceClient();

    // ── Helper: write an event to agent_execution_events ──────────────────
    const emitEvent = async (eventType: string, payload: Record<string, unknown>) => {
      await supabaseService.from('agent_execution_events').insert({
        session_id: executionId,
        tenant_id: tenantId,
        mission_id: missionId,
        chat_id: chatId,
        event_type: eventType,
        payload,
      });
    };

    // ── Step 1: Load tools + system prompt ────────────────────────────────
    const setup = await step.run('setup', async () => {
      const { buildChatContext } = await import('@/lib/services/chat-context');
      const { loadMissionTools } = await import('@/lib/services/tool-registry');

      const { systemPrompt } = await buildChatContext(missionId, tenantId, false);
      const { tools, toolMeta } = await loadMissionTools(tenantId, missionId, connectedProviders);

      // Serialize toolMeta Map → array for step checkpointing
      const toolMetaEntries: Array<[string, ToolMeta]> = Array.from(toolMeta.entries());

      return { systemPrompt, tools, toolMetaEntries };
    });

    const { systemPrompt, tools } = setup;
    const toolMetaMap = new Map<string, ToolMeta>(setup.toolMetaEntries);

    // ── Build message history ─────────────────────────────────────────────
    // recentMessages from browser + first assistant response (planning + tool_use)
    const messages: Array<{ role: string; content: unknown }> = [
      ...recentMessages,
      { role: 'assistant', content: firstAssistantContent },
    ];

    let fullAdditionalText = ''; // text from rounds after the first Vercel call
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const toolsUsed: string[] = [];

    // ── Agentic loop ───────────────────────────────────────────────────────
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Get tool_use blocks from the last assistant message
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role !== 'assistant') break;

      const assistantContent = Array.isArray(lastMsg.content) ? lastMsg.content as SerializedContentBlock[] : [];
      const toolBlocks = assistantContent.filter(b => b.type === 'tool_use' && b.id && b.name);
      if (toolBlocks.length === 0) break;

      // ── Execute tool calls for this round ────────────────────────────────
      const toolResults = await step.run(`tools-round-${round}`, async () => {
        const { executeTool, describeToolCall } = await import('@/lib/services/tool-registry');
        const { checkCredits, deductCredits, CREDIT_COSTS } = await import('@/lib/middleware/billing');
        const supabase = createServiceClient();
        const results: Array<{ type: string; tool_use_id: string; content: string }> = [];

        for (const block of toolBlocks) {
          const meta = toolMetaMap.get(block.name!);
          const providerSlug = meta?.providerSlug ?? 'system';
          const logoUrl = meta?.logoUrl ?? null;
          const displayName = meta?.displayName ?? block.name!;
          const input = block.input ?? {};
          const label = describeToolCall(block.name!, input);

          // Credit gate per tool call
          const creditCheck = await checkCredits(tenantId, CREDIT_COSTS.tool_call);
          if (!creditCheck.allowed) {
            await supabase.from('agent_execution_events').insert({
              session_id: executionId, tenant_id: tenantId, mission_id: missionId, chat_id: chatId,
              event_type: 'agent_error',
              payload: { message: 'Not enough credits to continue. Please top up your credits and try again.', creditsRemaining: creditCheck.creditsRemaining ?? 0 },
            });
            // Return empty results so the loop exits naturally
            return [];
          }

          // Emit running status
          await supabase.from('agent_execution_events').insert({
            session_id: executionId, tenant_id: tenantId, mission_id: missionId, chat_id: chatId,
            event_type: 'tool_status',
            payload: { name: block.name, provider: providerSlug, displayName, status: 'running', label, logoUrl },
          });

          toolsUsed.push(block.name!);

          let result: { content: string; summary: string };
          try {
            result = await Promise.race([
              executeTool(block.name!, input, tenantId, missionId, supabase),
              new Promise<{ content: string; summary: string }>((_, reject) =>
                setTimeout(() => reject(new Error('Tool timed out')), TOOL_TIMEOUT_MS)
              ),
            ]);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result = { content: `Tool "${block.name}" failed: ${msg}`, summary: `${block.name} failed` };
          }

          const isDone = !result.summary.includes('failed') && !result.summary.includes('timed out');

          // Emit done/error status
          await supabase.from('agent_execution_events').insert({
            session_id: executionId, tenant_id: tenantId, mission_id: missionId, chat_id: chatId,
            event_type: 'tool_status',
            payload: { name: block.name, provider: providerSlug, displayName, status: isDone ? 'done' : 'error', summary: result.summary, logoUrl },
          });

          // Deduct credits (non-fatal if fails)
          deductCredits(tenantId, CREDIT_COSTS.tool_call, `tool_call:${block.name!}`, {
            provider: providerSlug, model: providerSlug,
          }).catch(() => {});

          results.push({ type: 'tool_result', tool_use_id: block.id!, content: result.content });
        }

        return results;
      });

      if (toolResults.length === 0) break; // credit exhausted or empty

      // Add tool results to message history
      messages.push({ role: 'assistant', content: assistantContent });
      messages.push({ role: 'user', content: toolResults });

      // ── Next LLM call (non-streaming) ────────────────────────────────────
      const llmResult = await step.run(`llm-round-${round}`, async () => {
        const { checkCredits, deductCredits, calculateChatCreditCost } = await import('@/lib/middleware/billing');

        // Pre-flight credit check for LLM call
        const creditCheck = await checkCredits(tenantId, 4);
        if (!creditCheck.allowed) {
          return { stopReason: 'credit_exhausted', content: [], inputTokens: 0, outputTokens: 0 };
        }

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return { stopReason: 'error', content: [], inputTokens: 0, outputTokens: 0 };

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 8192,
            stream: false,
            system: systemPrompt,
            tools,
            messages,
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          console.error('[chat-agent] Anthropic error:', err);
          return { stopReason: 'error', content: [], inputTokens: 0, outputTokens: 0 };
        }

        const data = await response.json() as {
          content: SerializedContentBlock[];
          stop_reason: string;
          usage: { input_tokens: number; output_tokens: number };
        };

        // Deduct LLM credits (non-fatal)
        calculateChatCreditCost(data.usage.input_tokens, data.usage.output_tokens, model)
          .then(cost => deductCredits(tenantId, cost, 'chat_message_agent', {
            provider: 'anthropic', model, inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens,
          }))
          .catch(() => {});

        return {
          stopReason: data.stop_reason,
          content: data.content,
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        };
      });

      totalInputTokens += llmResult.inputTokens;
      totalOutputTokens += llmResult.outputTokens;

      if (llmResult.stopReason === 'credit_exhausted') {
        await emitEvent('agent_error', { message: 'Not enough credits to continue. Please top up and try again.' });
        return { success: false, reason: 'credit_exhausted' };
      }

      if (llmResult.stopReason === 'error') {
        await emitEvent('agent_error', { message: 'Something went wrong. Please try again.' });
        return { success: false, reason: 'llm_error' };
      }

      // Accumulate text from this LLM response
      const textBlocks = (llmResult.content as SerializedContentBlock[]).filter(b => b.type === 'text' && b.text);
      fullAdditionalText += textBlocks.map(b => b.text!).join('');

      // Add to messages for next round
      messages.push({ role: 'assistant', content: llmResult.content });

      if (llmResult.stopReason !== 'tool_use') break;
    }

    // ── Step: Save message + emit agent_completed ─────────────────────────
    await step.run('complete', async () => {
      const { writeEpisode } = await import('@/lib/services/agent-memory');
      const supabase = createServiceClient();

      // Full text = planning text (already shown) + any additional text from tool rounds
      const combinedText = planningText
        ? fullAdditionalText
            ? `${planningText}\n\n${fullAdditionalText}`
            : planningText
        : fullAdditionalText;

      const cleanText = combinedText.replace(/<action>[\s\S]*?<\/action>/g, '').trim();

      // Parse action payload if present
      let actionPayload: Record<string, unknown> | null = null;
      const actionMatch = combinedText.match(/<action>([\s\S]*?)<\/action>/);
      if (actionMatch) {
        try { actionPayload = JSON.parse(actionMatch[1]); } catch { /* ignore */ }
      }

      // Persist messages
      const userMsg = recentMessages[recentMessages.length - 1];
      if (userMsg) {
        await supabase.from('mission_chat_messages').insert({
          chat_id: chatId, tenant_id: tenantId, role: userMsg.role, content: userMsg.content,
        });
      }

      const { data: savedMsg } = await supabase.from('mission_chat_messages').insert({
        chat_id: chatId, tenant_id: tenantId,
        role: 'assistant', content: cleanText,
        action_payload: actionPayload,
        input_tokens: totalInputTokens, output_tokens: totalOutputTokens,
      }).select('id').single();

      await supabase.from('mission_chats').update({ updated_at: new Date().toISOString() }).eq('id', chatId);

      // Write episode memory (fire-and-forget)
      const allMsgs = [
        ...recentMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'assistant' as const, content: cleanText },
      ];
      writeEpisode(tenantId, missionId, allMsgs, toolsUsed).catch(() => {});

      // Signal the frontend that execution is complete
      await supabase.from('agent_execution_events').insert({
        session_id: executionId,
        tenant_id: tenantId,
        mission_id: missionId,
        chat_id: chatId,
        event_type: 'agent_completed',
        payload: {
          messageId: savedMsg?.id ?? null,
          cleanText,
          action: actionPayload,
          sessionId: chatId,
        },
      });
    });

    return { success: true, executionId };
  }
);
