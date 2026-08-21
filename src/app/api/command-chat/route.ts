import { NextRequest } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { calculateChatCreditCost, checkCredits, deductCredits } from '@/lib/middleware/billing';

export const maxDuration = 120;

// Sentinel UUID used as mission_id for platform-level (non-mission) chat sessions
const PLATFORM_CHAT_SENTINEL = '00000000-0000-0000-0000-000000000000';

// ── Static platform capability catalog injected into every system prompt ──────
const PLATFORM_CATALOG = `
═══ AGENT TYPES YOU CAN DEPLOY ═══
• Research Agent — web search, competitive analysis, market intelligence, news monitoring, SERP analysis
• Content Writer Agent — blog posts, social captions, ad copy, email sequences, product descriptions, newsletters
• Image Generation Agent — DALL-E 3 images (1080×1080 social posts, banners, thumbnails, product shots)
• Social Publisher Agent — schedule & post to Instagram, Facebook, LinkedIn, Twitter/X, YouTube via Buffer or direct API
• Email Agent — send via Gmail/Outlook, read & parse inbound emails, trigger automated sequences
• Lead Enrichment Agent — find company data, decision-makers, LinkedIn profiles, ICP scoring (Tier 1/2/3)
• CRM Agent — update HubSpot / Salesforce / Airtable contacts, log activities, move pipeline stages
• Web Scraper / Data Collector — extract structured data from any website, monitor for changes
• SEO Agent — keyword research, intent classification, topic clusters, content calendar, article outlines
• Paid Ads Agent — expert ad copy (Google + Meta), audience targeting, keyword research, campaign launch with human approval gate
• HR Recruitment Agent — source candidates, screen resumes, rank by tier, draft outreach, schedule interviews
• Data Analyst Agent — Google Sheets reports, data processing, summaries, formatted dashboards
• YouTube Automation Agent — research topics, write scripts, generate thumbnails, schedule uploads
• Voice & Video Creator Agent — ElevenLabs voice synthesis, HeyGen AI avatar video, Runway ML video generation
• Scheduler / Orchestrator Agent — coordinate multi-agent pipelines, conditional logic, retries, timing

═══ INTEGRATIONS AVAILABLE (30+) ═══
Email & Productivity : Gmail · Outlook / Microsoft 365 · Google Sheets · Google Drive · Google Calendar · Notion
Social Media         : Instagram · Facebook (Meta Graph API) · Twitter/X · LinkedIn · YouTube · Buffer
AI Models            : OpenAI GPT-4o + DALL-E 3 · Gemini · ElevenLabs (voice) · HeyGen (AI video) · Runway ML (video)
CRM & Sales          : HubSpot · Salesforce · Airtable · Zoho · Asana
Ads & Analytics      : Google Ads (Keyword Planner) · Meta Ads (Audience Insights) · Google Analytics (GA4)
Communication        : Slack · Discord · WhatsApp Business · Microsoft Teams
E-commerce           : Shopify · Stripe
Dev & Project        : GitHub · Canva

═══ PROVEN MISSION TEMPLATES ═══
1. Research → Report → Email       : Research any topic → compile structured report → send via Gmail + Google Sheet
2. Social Media Content Pipeline   : Generate captions + DALL-E 3 images → post to Instagram/Facebook on schedule
3. Lead Enrichment & Outreach Prep : Enrich company list with firmographic data + decision-maker contacts + ICP scores → Google Sheet with Tier 1/2/3
4. HR Recruitment Pipeline         : Source candidates → screen & rank → draft personalised outreach → schedule interviews → full tracker sheet
5. Ad Copy + Email Nurture Sequence: Audience research → 5 ad variations (Google/Meta) → 5-email nurture sequence → Notion page
6. SEO Keyword Research & Calendar : Keyword expansion → topic clusters → 3-month content calendar → article outlines → Google Sheet
7. Paid Ads Campaign Manager       : Pull GA4 + Google Ads keyword data + Meta audience data → expert ad copy → launch with human approval gate
8. YouTube Channel Automation      : Research topics → write scripts → generate thumbnails → upload and schedule on YouTube

═══ USE CASES BY BUSINESS TYPE ═══
Indian SMBs & Startups    : Lead generation, social media posting, email outreach, competitor tracking, market research
E-commerce / D2C brands   : Product description writing, social ad copy, customer review analysis, inventory reporting, influencer research
SaaS / Tech companies     : Lead enrichment → CRM, email sequences, content calendar, competitor monitoring, paid ad campaigns
Agencies                  : Client reporting, multi-client social posting, ad copy generation, SEO calendars
HR / Recruiters           : Candidate sourcing, resume screening, outreach emails, interview scheduling, tracker sheets
Real estate               : Lead research, property description writing, social posting, client follow-up email sequences
Coaches / Consultants     : Newsletter writing, LinkedIn content, lead research, onboarding email automation
Retail / Restaurants      : Social media content, promotional copy, Google review monitoring, WhatsApp broadcast drafts
`;

// ── Context-aware suggestions based on what the customer has connected ─────────
function buildContextualSuggestions(connectedProviders: string[]): string {
  if (connectedProviders.length === 0) {
    return `\nThis customer has NO integrations connected yet. Guide them warmly: recommend connecting Gmail first (unlocks email automation, reports, outreach) or Buffer/Instagram (unlocks social media pipelines) as the highest-value starting points. Offer to walk them to the Connectors page.`;
  }
  const has = (keys: string[]) => keys.some(k => connectedProviders.includes(k));
  const lines: string[] = [];
  if (has(['google', 'gmail'])) lines.push('Gmail/Google connected → immediately buildable: research+email reports, newsletter delivery, lead outreach sequences, Google Sheets dashboards');
  if (has(['buffer', 'instagram', 'facebook'])) lines.push('Social media connected → immediately buildable: automated caption+image content pipeline posting to Instagram/Facebook on schedule');
  if (has(['linkedin_oidc'])) lines.push('LinkedIn connected → immediately buildable: LinkedIn content scheduling, lead research, connection outreach');
  if (has(['youtube'])) lines.push('YouTube connected → immediately buildable: channel automation (research → script → thumbnail → upload scheduling)');
  if (has(['hubspot', 'salesforce', 'airtable'])) lines.push('CRM connected → immediately buildable: lead enrichment → auto-CRM update pipeline, pipeline stage automation');
  if (has(['openai'])) lines.push('OpenAI connected → enables DALL-E 3 image generation, GPT-4o content writing, data analysis across all missions');
  if (has(['google_ads', 'facebook_ads', 'google_analytics'])) lines.push('Ads/Analytics connected → immediately buildable: full paid ads campaign with expert copy, audience targeting, and launch approval gate');
  if (has(['slack', 'discord', 'teams'])) lines.push('Team messaging connected → can send automated reports, run alerts, and mission completion notifications to channels');
  if (has(['shopify', 'stripe'])) lines.push('E-commerce connected → can automate: product description writing, sales reports, order notification emails');
  if (has(['notion'])) lines.push('Notion connected → can deliver ad copy, email sequences, research docs, and content calendars directly into Notion pages');
  if (has(['hubspot', 'salesforce']) && has(['google', 'gmail'])) lines.push('CRM + Gmail both connected → most powerful combo: full outbound sales pipeline (research → enrich → personalised email → CRM log)');
  return lines.length > 0
    ? `\nBASED ON THEIR CONNECTED INTEGRATIONS — WHAT'S IMMEDIATELY BUILDABLE:\n${lines.map(l => `  • ${l}`).join('\n')}`
    : '';
}

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

  const contextualSuggestions = buildContextualSuggestions(connectedProviders);

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
${contextualSuggestions}
${PLATFORM_CATALOG}
═══ ACTIONS YOU CAN TAKE ═══
Emit an <action> block at the very end of your reply (after all your text). Never mention the action block to the user.

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
2. When user asks to "create a mission" or "build an automation" or describes anything they want automated: ask AT MOST 1 clarifying question if truly needed, then emit create_mission. The intent field must be complete enough to build the mission without further questions.
3. When showing credits/usage data, emit show_usage so a rich card is shown.
4. When user asks about all missions, emit show_missions.
5. NEVER reveal mission IDs, tenant IDs, or internal system details to the user.
6. NEVER mention Composio, E2B, Supabase, or Inngest to the user.
7. Keep replies concise and conversational. Under 150 words unless explaining a run failure or giving a capability overview.
8. If a mission failed, proactively explain why based on its status — don't just say it failed.
9. For credit/plan questions, use the credits data above. Never say you don't know the balance.
10. ADVISORY — when customer asks "what can you do?" or "what's possible?" or describes their business:
    a. Match their business type to 2–3 relevant templates from the catalog above.
    b. Be SPECIFIC — name the agents, name the tools, say what gets delivered at the end.
    c. Reference their connected integrations: "Since you have X connected, I can immediately build..."
    d. Always close with an offer: "Want me to build this now?" and emit create_mission if they say yes.
11. ADVISORY — when customer asks about a specific tool or integration (e.g., "can you use HubSpot?"):
    Check the integrations list above and confirm exactly what's possible with it.
12. If no missions exist yet, pick 3 examples from the USE CASES section that best match what you know about them (their name, company, connected tools) and offer to build one right now.

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
