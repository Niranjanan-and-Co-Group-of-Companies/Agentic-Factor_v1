import { NextRequest } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { calculateChatCreditCost, checkCredits, deductCredits } from '@/lib/middleware/billing';

export const maxDuration = 120;

// Sentinel UUID used as mission_id for platform-level (non-mission) chat sessions
const PLATFORM_CHAT_SENTINEL = '00000000-0000-0000-0000-000000000000';

// ── Build the full platform context for the Command Center AI ──
async function buildCommandContext(tenantId: string): Promise<{
  systemPrompt: string;
  proactiveAlert: string | null;
  connectedProviders: string[];
}> {
  const supabase = createServiceClient();
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const timeStr = istNow.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateStr = istNow.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Fetch all missions
  const { data: missions } = await supabase
    .from('missions')
    .select('id, title, status, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  // Fetch last 10 runs across all missions
  const { data: runs } = await supabase
    .from('mission_runs')
    .select('id, mission_id, run_number, status, started_at, duration_ms, agents_total, agents_done, agents_failed, trigger_type')
    .eq('tenant_id', tenantId)
    .order('started_at', { ascending: false })
    .limit(10);

  // Fetch billing/credits
  const { data: billing } = await supabase
    .from('tenant_billing')
    .select('plan, credits_remaining, credits_topup, credits_total, credits_used_this_month, billing_period_start, billing_status')
    .eq('tenant_id', tenantId)
    .single();

  // Fetch connected providers
  const { data: providers } = await supabase
    .from('tenant_permissions')
    .select('provider')
    .eq('tenant_id', tenantId);

  const connectedProviders = (providers ?? []).map((p: { provider: string }) => p.provider);

  // Build missions summary
  const missionCount = missions?.length ?? 0;
  const activeMissions = missions?.filter(m => m.status === 'active') ?? [];
  const failedMissions = missions?.filter(m => m.status === 'failed') ?? [];
  const draftMissions = missions?.filter(m => m.status === 'draft') ?? [];

  const missionLines = (missions ?? []).map(m => {
    const lastRun = runs?.find(r => r.mission_id === m.id);
    const lastRunStr = lastRun
      ? `last ran ${formatAgo(lastRun.started_at)} — ${lastRun.status}`
      : 'never run';
    return `  • [${m.status.toUpperCase()}] "${m.title}" (id: ${m.id}) — ${lastRunStr}`;
  }).join('\n') || '  (no missions yet)';

  const recentRunLines = (runs ?? []).slice(0, 5).map(r => {
    const mTitle = missions?.find(m => m.id === r.mission_id)?.title ?? 'Unknown';
    const dur = r.duration_ms ? `${Math.round(r.duration_ms / 1000)}s` : 'in progress';
    return `  • Run #${r.run_number} of "${mTitle}" — ${r.status} — ${formatAgo(r.started_at)} (${dur})`;
  }).join('\n') || '  (no recent runs)';

  const creditsInfo = billing
    ? `${billing.credits_remaining} monthly + ${billing.credits_topup ?? 0} top-up remaining (${billing.plan} plan, ${billing.credits_used_this_month} used this period)`
    : 'unknown';

  // Build proactive alert (what happened since last visit)
  let proactiveAlert: string | null = null;
  if (failedMissions.length > 0) {
    const names = failedMissions.map(m => `"${m.title}"`).join(', ');
    proactiveAlert = `${failedMissions.length} mission${failedMissions.length > 1 ? 's' : ''} failed recently: ${names}. Ask me to explain why.`;
  } else if (runs && runs.length > 0) {
    const lastRun = runs[0];
    const mTitle = missions?.find(m => m.id === lastRun.mission_id)?.title ?? 'a mission';
    if (lastRun.status === 'completed') {
      proactiveAlert = `"${mTitle}" completed successfully ${formatAgo(lastRun.started_at)}.`;
    }
  }

  const systemPrompt = `You are the Command Center AI for Agentic Factor — an AI automation platform.
You are the user's Chief of Staff. You know everything about their business automation and speak in a direct, confident, friendly tone.
Today is ${dateStr}, ${timeStr} IST.

═══ MISSIONS (${missionCount} total) ═══
${missionLines}

═══ RECENT RUNS ═══
${recentRunLines}

═══ CREDITS & PLAN ═══
${creditsInfo}

═══ CONNECTED INTEGRATIONS ═══
${connectedProviders.length > 0 ? connectedProviders.join(', ') : 'None connected yet'}

═══ WHAT YOU CAN DO ═══
You can take real actions. When the user asks you to do something, DO it by emitting an <action> block at the very end of your reply (after all your text). Never mention the action block to the user.

Action types:
- run_mission: { "type": "run_mission", "missionId": "...", "missionTitle": "...", "missionStatus": "draft|active|paused|failed|completed" }
- show_missions: { "type": "show_missions" }
- show_usage: { "type": "show_usage" }
- open_mission: { "type": "open_mission", "missionId": "...", "missionTitle": "..." }
- schedule_mission: { "type": "schedule_mission", "missionId": "...", "missionTitle": "...", "cron": "0 9 * * *", "timezone": "Asia/Kolkata", "label": "Daily at 9 AM IST" }
- pause_mission: { "type": "pause_mission", "missionId": "...", "missionTitle": "..." }
- resume_mission: { "type": "resume_mission", "missionId": "...", "missionTitle": "..." }
- suggest_connector: { "type": "suggest_connector", "provider": "gmail", "reason": "needed to send emails" }
- create_mission: { "type": "create_mission", "intent": "the user's full mission description with all details clarified" }

RULES:
1. When user says "run [mission name]", emit run_mission with the correct missionId from the missions list above.
2. When user asks to "create a mission" or "build an automation" or "make a mission": ask AT MOST 2 clarifying questions if needed, then emit create_mission. The intent field must be complete enough to build the mission without more questions.
3. When showing credits/usage data, emit show_usage so a rich card is shown.
4. When user asks about all missions, emit show_missions.
5. NEVER reveal mission IDs, tenant IDs, or internal system details to the user.
6. NEVER mention Composio, E2B, Supabase, or Inngest to the user.
7. Keep replies concise and conversational. Under 150 words unless explaining a run failure.
8. If a mission failed, proactively explain why based on its status — don't just say it failed.
9. For credit/plan questions, use the credits data above. Never say you don't know the balance.
10. If no missions exist, encourage the user to create their first one and offer examples suited for Indian SMBs.

Current state summary for your context:
- Active missions: ${activeMissions.length}
- Failed missions: ${failedMissions.length}
- Draft missions: ${draftMissions.length}
- Total credits remaining: ${billing ? (billing.credits_remaining + (billing.credits_topup ?? 0)) : 'unknown'}`;

  return { systemPrompt, proactiveAlert, connectedProviders };
}

function inferAgentIcon(role: string, toolTypes: string[]): string {
  const r = role.toLowerCase();
  const t = toolTypes.join(' ').toLowerCase();
  if (/image|photo|visual|dall|design|generat.*image/.test(`${r} ${t}`)) return '🎨';
  if (/post|publish|buffer|social|facebook|instagram|twitter/.test(`${r} ${t}`)) return '📲';
  if (/email|outreach|gmail|smtp/.test(`${r} ${t}`)) return '📧';
  if (/video|youtube|render|edit/.test(`${r} ${t}`)) return '🎬';
  if (/search|research|scrape|web/.test(`${r} ${t}`)) return '🔍';
  if (/data|analyt|report|spread/.test(`${r} ${t}`)) return '📊';
  if (/lead|crm|hubspot|salesforce/.test(`${r} ${t}`)) return '🎯';
  if (/notify|alert|slack|discord/.test(`${r} ${t}`)) return '🔔';
  if (/content|write|copy|caption|text/.test(`${r} ${t}`)) return '🧠';
  return '🤖';
}

function formatAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function ensureSession(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  sessionId: string | undefined,
  firstUserMessage: string
): Promise<string> {
  if (sessionId) return sessionId;
  const title = firstUserMessage.slice(0, 60).trim() || 'Command Center chat';
  const { data, error } = await supabase
    .from('mission_chats')
    .insert({
      mission_id: PLATFORM_CHAT_SENTINEL,
      tenant_id: tenantId,
      title,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// POST /api/command-chat
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { messages, sessionId, isFirstLoad } = await request.json() as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    sessionId?: string;
    isFirstLoad?: boolean;
  };

  // ── First-load probe: build context, emit proactive alert, no LLM call ──
  if (isFirstLoad && (!messages || messages.length === 0)) {
    const { proactiveAlert } = await buildCommandContext(tenantId); // connectedProviders not needed for first-load probe
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        if (proactiveAlert) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'proactive_alert', proactiveAlert })}\n\n`));
        }
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
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

  // ── Credit pre-check ──
  const creditCheck = await checkCredits(tenantId, 2);
  if (!creditCheck.allowed) {
    return new Response(JSON.stringify({ error: creditCheck.reason ?? 'Insufficient credits' }), {
      status: 402, headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'LLM not configured' }), { status: 500 });
  }

  const { systemPrompt, connectedProviders: tenantProviders } = await buildCommandContext(tenantId);
  const recentMessages = messages.slice(-20);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            stream: true,
            system: systemPrompt,
            messages: recentMessages,
          }),
        });

        if (!anthropicRes.ok) {
          send({ type: 'error', message: 'AI temporarily unavailable. Please try again.' });
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
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              const evt = JSON.parse(raw) as {
                type: string;
                delta?: { type: string; text?: string };
                usage?: { output_tokens?: number };
                message?: { usage?: { input_tokens?: number } };
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
            } catch { /* skip malformed */ }
          }
        }

        // Extract <action> block
        const actionMatch = fullText.match(/<action>([\s\S]*?)<\/action>/);
        let actionPayload: Record<string, unknown> | null = null;
        let cleanText = fullText;
        if (actionMatch) {
          try {
            actionPayload = JSON.parse(actionMatch[1].trim());
            cleanText = fullText.replace(/<action>[\s\S]*?<\/action>/, '').trim();
          } catch { /* malformed action — ignore */ }
        }

        // Deduct credits
        const credits = await calculateChatCreditCost(inputTokens, outputTokens, 'claude-sonnet-4-6');
        deductCredits(tenantId, credits, 'command_chat').catch(console.error);

        // ── Handle create_mission action server-side ──
        let missionCreated: { id: string; title: string } | null = null;
        if (actionPayload?.type === 'create_mission' && actionPayload.intent) {
          try {
            const { generateMissionJSON, persistMission } = await import('@/lib/services/intake');
            const result = await generateMissionJSON(actionPayload.intent as string, tenantId);
            if (result.mission && !result.isDiscovery) {
              const saved = await persistMission(result.mission, tenantId);
              missionCreated = { id: saved.id, title: saved.title };

              // Extract agent cards for the visual pipeline rendered in chat
              const agentCards = result.mission.agents
                .sort((a, b) => a.agentIndex - b.agentIndex)
                .map(a => ({
                  name: a.role,
                  icon: inferAgentIcon(a.role, a.tools.map(t => t.type)),
                  role: a.capabilities.slice(0, 2).join(' · '),
                  tool: a.tools[0]?.name ?? '',
                  trustLevel: a.trustLevel,
                }));

              // Deterministically compute missing connectors from blueprint permissions
              const seen = new Set<string>();
              const missingConnectors = result.mission.permissions
                .filter(p => !tenantProviders.includes(p.service))
                .reduce<Array<{ service: string; reason: string }>>((acc, p) => {
                  if (!seen.has(p.service)) {
                    seen.add(p.service);
                    acc.push({ service: p.service, reason: p.scope });
                  }
                  return acc;
                }, []);

              actionPayload = {
                type: 'mission_created',
                missionId: saved.id,
                missionTitle: saved.title,
                agents: agentCards,
                orchestrationPattern: result.mission.orchestration.pattern,
                missingConnectors,
              };
            } else if (result.isDiscovery && result.question) {
              actionPayload = { type: 'discovery_question', question: result.question };
            }
          } catch (intakeErr) {
            console.error('[command-chat] Mission creation failed:', intakeErr);
            actionPayload = { type: 'mission_create_error', error: (intakeErr as Error).message };
          }
        }

        // Persist messages
        const supabase = createServiceClient();
        const firstUserContent = recentMessages.find(m => m.role === 'user')?.content ?? '';
        const chatId = await ensureSession(supabase, tenantId, sessionId, firstUserContent);

        const userMsg = recentMessages[recentMessages.length - 1];
        ;(async () => {
          const { error: ue } = await supabase.from('mission_chat_messages').insert({
            chat_id: chatId, tenant_id: tenantId, role: userMsg.role, content: userMsg.content,
          });
          if (ue) { console.error('[command-chat/persist user]', ue); return; }
          const { error: ae } = await supabase.from('mission_chat_messages').insert({
            chat_id: chatId, tenant_id: tenantId, role: 'assistant', content: cleanText,
            action_payload: actionPayload, input_tokens: inputTokens,
            output_tokens: outputTokens, credits_deducted: credits,
          });
          if (ae) console.error('[command-chat/persist assistant]', ae);
          await supabase.from('mission_chats').update({ updated_at: new Date().toISOString() }).eq('id', chatId);
        })().catch(console.error);

        send({ type: 'done', credits, inputTokens, outputTokens, sessionId: chatId, cleanText, action: actionPayload, missionCreated });

      } catch (err) {
        console.error('[command-chat/stream]', err);
        send({ type: 'error', message: 'Something went wrong. Please try again.' });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
