import { NextRequest } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { calculateChatCreditCost, checkCredits, deductCredits } from '@/lib/middleware/billing';
import { detectApiKey, redactKey, providerLabel } from '@/lib/services/apikey-detector';
import { verifyApiKey } from '@/lib/services/apikey-verifier';
import { retrieveRelevantChunks, listUploadedDocuments } from '@/lib/services/rag-retrieval';

export const maxDuration = 300;

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

  // proactiveAlert intentionally not used — Command Center shows a dynamic
  // welcome message instead. Negative alerts (failures) are never surfaced
  // as banners; the AI can discuss failures when the user asks.
  const proactiveAlert: string | null = null;

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
CRITICAL: You MUST wrap every action in <action>...</action> tags — always, regardless of how long the JSON is, regardless of how complex the request is. Never output action JSON as plain text. The tags are required for the UI to render correctly. Place the <action> block at the very end of your reply, after all your text. Never mention the action block to the user.

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

// ── Command Center tool definitions ───────────────────────────────────────

const CC_TOOLS = [
  {
    name: 'search_web',
    description: 'Search the internet for current information — news, research, company data, competitor info, market intelligence. Use when the user asks about something that requires up-to-date information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Search query' },
      },
      required: ['query'] as string[],
    },
  },
  {
    name: 'get_mission_details',
    description: 'Get detailed status, recent run history, and error information for a specific mission by its ID. Use when the user asks for details about a specific mission.',
    input_schema: {
      type: 'object' as const,
      properties: {
        mission_id: { type: 'string' as const, description: 'Mission UUID' },
      },
      required: ['mission_id'] as string[],
    },
  },
];

// Streaming parser (same pattern as mission chat)
interface CCContentBlock { type: 'text' | 'tool_use'; text?: string; id?: string; name?: string; inputJson?: string }
interface CCStreamResult { textContent: string; contentBlocks: CCContentBlock[]; stopReason: string; inputTokens: number; outputTokens: number }

async function parseCCStream(response: Response, onTextDelta: (t: string) => void): Promise<CCStreamResult> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const contentBlocks: CCContentBlock[] = [];
  let stopReason = 'end_turn';
  let inputTokens = 0, outputTokens = 0, fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const evt = JSON.parse(raw) as {
          type: string; index?: number;
          content_block?: { type: string; id?: string; name?: string };
          delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
          usage?: { output_tokens?: number };
          message?: { usage?: { input_tokens?: number } };
        };
        if (evt.type === 'message_start' && evt.message?.usage) inputTokens = evt.message.usage.input_tokens ?? 0;
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
      } catch { /* skip malformed */ }
    }
  }
  return { textContent: fullText, contentBlocks, stopReason, inputTokens, outputTokens };
}

async function executeCCTool(
  name: string,
  input: Record<string, unknown>,
  tenantId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ content: string; summary: string }> {

  if (name === 'search_web') {
    const query = String(input.query ?? '');
    if (!query) return { content: 'No query provided.', summary: 'Missing query' };

    let apiKey = process.env.TAVILY_API_KEY ?? '';
    try {
      const { data } = await supabase.from('tenant_permissions').select('access_token').eq('tenant_id', tenantId).eq('provider', 'tavily').maybeSingle();
      if (data?.access_token && data.access_token !== 'composio_managed') apiKey = data.access_token;
    } catch { /* use env key */ }

    if (!apiKey) return { content: 'Web search not configured.', summary: 'Not configured' };
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ query, max_results: 5, search_depth: 'basic' }),
        signal: AbortSignal.timeout(12_000),
      });
      const data = await res.json() as { results?: Array<{ title: string; content: string; url: string }> };
      const results = (data.results ?? []).slice(0, 5);
      const formatted = results.map(r => `[${r.title}]\n${r.content.slice(0, 300)}\n${r.url}`).join('\n\n');
      return { content: formatted || 'No results.', summary: `${results.length} results for "${query}"` };
    } catch (err) {
      return { content: `Search failed: ${err instanceof Error ? err.message : String(err)}`, summary: 'Search failed' };
    }
  }

  if (name === 'get_mission_details') {
    const missionId = String(input.mission_id ?? '');
    if (!missionId) return { content: 'No mission ID provided.', summary: 'Missing ID' };
    try {
      const [{ data: mission }, { data: runs }] = await Promise.all([
        supabase.from('missions').select('title, status, mission_json').eq('id', missionId).eq('tenant_id', tenantId).single(),
        supabase.from('mission_runs').select('run_number, status, started_at, duration_ms, agents_done, agents_failed, agents_total, summary').eq('mission_id', missionId).eq('tenant_id', tenantId).order('started_at', { ascending: false }).limit(3),
      ]);
      if (!mission) return { content: 'Mission not found or access denied.', summary: 'Not found' };
      const runLines = (runs ?? []).map(r => `  Run #${r.run_number}: ${r.status}, agents: ${r.agents_done}/${r.agents_total}, ${r.duration_ms ? Math.round(r.duration_ms / 1000) + 's' : '?'}`).join('\n') || '  No runs yet';
      return {
        content: `Mission: "${mission.title}" — Status: ${mission.status}\n\nRecent runs:\n${runLines}`,
        summary: `"${mission.title}" is ${mission.status}`,
      };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, summary: 'Error fetching mission' };
    }
  }

  return { content: `Unknown tool: ${name}`, summary: 'Unknown tool' };
}

async function runCommandLoop(params: {
  systemPrompt: string;
  messages: Array<{ role: string; content: unknown }>;
  apiKey: string;
  tenantId: string;
  supabase: ReturnType<typeof createServiceClient>;
  send: (obj: Record<string, unknown>) => void;
}): Promise<{ fullText: string; inputTokens: number; outputTokens: number }> {
  const { systemPrompt, apiKey, tenantId, supabase, send } = params;
  const messages = [...params.messages];
  let totalInputTokens = 0, totalOutputTokens = 0, fullText = '';
  const MAX_ROUNDS = 8;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, stream: true, system: systemPrompt, tools: CC_TOOLS, messages }),
    });

    if (!res.ok) { send({ type: 'error', message: 'AI temporarily unavailable. Please try again.' }); break; }

    const { textContent, contentBlocks, stopReason, inputTokens, outputTokens } =
      await parseCCStream(res, text => send({ type: 'delta', text }));
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    if (textContent) fullText += textContent;

    const assistantContent: unknown[] = [];
    for (const block of contentBlocks) {
      if (block.type === 'text' && block.text) assistantContent.push({ type: 'text', text: block.text });
      else if (block.type === 'tool_use' && block.id) {
        let inp: Record<string, unknown> = {};
        try { inp = JSON.parse(block.inputJson ?? '{}'); } catch { /* empty */ }
        assistantContent.push({ type: 'tool_use', id: block.id, name: block.name, input: inp });
      }
    }

    const toolBlocks = contentBlocks.filter(b => b.type === 'tool_use' && b.id && b.name);
    if (stopReason !== 'tool_use' || toolBlocks.length === 0) break;

    const toolResults: unknown[] = [];
    for (const block of toolBlocks) {
      let inp: Record<string, unknown> = {};
      try { inp = JSON.parse(block.inputJson ?? '{}'); } catch { /* empty */ }

      const label = block.name === 'search_web' ? `Searching "${inp.query}"…` : `Fetching mission details…`;
      send({ type: 'tool_status', name: block.name, provider: block.name === 'search_web' ? 'tavily' : 'system', displayName: block.name === 'search_web' ? 'Web Search' : 'Mission Details', status: 'running', label, logoUrl: block.name === 'search_web' ? 'https://tavily.com/favicon.ico' : null });

      const result = await executeCCTool(block.name!, inp, tenantId, supabase);

      send({ type: 'tool_status', name: block.name, provider: block.name === 'search_web' ? 'tavily' : 'system', displayName: block.name === 'search_web' ? 'Web Search' : 'Mission Details', status: 'done', summary: result.summary, logoUrl: block.name === 'search_web' ? 'https://tavily.com/favicon.ico' : null });

      toolResults.push({ type: 'tool_result', tool_use_id: block.id!, content: result.content });
    }

    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({ role: 'user', content: toolResults });
  }

  return { fullText, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
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

  // ── API key paste detection — intercept before LLM call ─────────────────────
  // If the customer pastes an API key directly into the chat, verify + save it
  // here without invoking the LLM. The key is never stored in chat history.
  const lastUserMsg = messages[messages.length - 1];
  const detectedKey = lastUserMsg?.role === 'user' ? detectApiKey(lastUserMsg.content) : null;

  if (detectedKey) {
    const verifyResult = await verifyApiKey(detectedKey.provider, { apiKey: detectedKey.key });
    const label = providerLabel(detectedKey.provider);
    const supabase = createServiceClient();

    let confirmationText: string;
    let actionPayload: Record<string, unknown>;

    if (verifyResult.verified) {
      await supabase.from('tenant_permissions').upsert(
        {
          tenant_id: tenantId,
          provider: detectedKey.provider,
          access_token: detectedKey.key,
          refresh_token: null,
          expires_at: null,
          scopes: ['apikey'],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,provider' }
      );
      confirmationText = `Your ${label} key is connected and ready to use.${verifyResult.accountInfo ? ` ${verifyResult.accountInfo}.` : ''}`;
      actionPayload = { type: 'key_connected', provider: detectedKey.provider, accountInfo: verifyResult.accountInfo };
    } else {
      confirmationText = `That doesn't look like a valid ${label} key — ${verifyResult.error ?? 'please check and try again'}.`;
      actionPayload = { type: 'key_connection_failed', provider: detectedKey.provider, error: verifyResult.error };
    }

    // Persist messages with key redacted so it never appears in chat history
    const redactedUserContent = redactKey(lastUserMsg.content, detectedKey);
    const firstUserContent = messages.find(m => m.role === 'user')?.content ?? '';
    const chatId = await ensureSession(supabase, tenantId, sessionId, firstUserContent);

    ;(async () => {
      await supabase.from('mission_chat_messages').insert({ chat_id: chatId, tenant_id: tenantId, role: 'user', content: redactedUserContent });
      await supabase.from('mission_chat_messages').insert({ chat_id: chatId, tenant_id: tenantId, role: 'assistant', content: confirmationText, action_payload: actionPayload });
      await supabase.from('mission_chats').update({ updated_at: new Date().toISOString() }).eq('id', chatId);
    })().catch(console.error);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        send({ type: 'delta', text: confirmationText });
        send({ type: 'done', credits: 0, inputTokens: 0, outputTokens: 0, sessionId: chatId, cleanText: confirmationText, action: actionPayload });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });
  }
  // ── End API key detection ────────────────────────────────────────────────────

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'LLM not configured' }), { status: 500 });
  }

  let { systemPrompt, connectedProviders: tenantProviders } = await buildCommandContext(tenantId);
  const recentMessages = messages.slice(-20);

  // ── RAG: inject relevant uploaded document context ────────────────────────
  const ccUserQuery = messages[messages.length - 1]?.content ?? '';
  const [ragCtx, docListCtx] = await Promise.all([
    retrieveRelevantChunks(tenantId, null, ccUserQuery),
    listUploadedDocuments(tenantId, null),
  ]);
  if (docListCtx) systemPrompt += `\n\n${docListCtx}`;
  if (ragCtx) systemPrompt += `\n\n${ragCtx}`;
  // ── End RAG ───────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const supabase = createServiceClient();
        const { fullText, inputTokens, outputTokens } = await runCommandLoop({
          systemPrompt,
          messages: recentMessages,
          apiKey,
          tenantId,
          supabase,
          send,
        });

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

        // Fallback: detect raw action JSON even when LLM omits <action> tags or truncation cut the closing tag.
        // Walks character by character, balancing braces so nested objects/arrays don't confuse it.
        if (!actionPayload) {
          const KNOWN_TYPES = new Set(['create_mission','run_mission','show_missions','show_usage','open_mission','schedule_mission','pause_mission','resume_mission','suggest_connector','key_connected','key_connection_failed']);
          const jsonStart = fullText.indexOf('{"type":');
          if (jsonStart !== -1) {
            let depth = 0, inString = false, escaped = false, jsonEnd = -1;
            for (let i = jsonStart; i < fullText.length; i++) {
              const ch = fullText[i];
              if (escaped) { escaped = false; continue; }
              if (ch === '\\' && inString) { escaped = true; continue; }
              if (ch === '"') { inString = !inString; continue; }
              if (inString) continue;
              if (ch === '{') depth++;
              if (ch === '}') { depth--; if (depth === 0) { jsonEnd = i; break; } }
            }
            if (jsonEnd !== -1) {
              try {
                const candidate = JSON.parse(fullText.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
                if (candidate.type && KNOWN_TYPES.has(candidate.type as string)) {
                  actionPayload = candidate;
                  cleanText = (fullText.slice(0, jsonStart) + fullText.slice(jsonEnd + 1)).trim();
                }
              } catch { /* not valid JSON — leave as plain text */ }
            }
          }
        }

        // Deduct credits
        const credits = await calculateChatCreditCost(inputTokens, outputTokens, 'claude-sonnet-4-6');
        deductCredits(tenantId, credits, 'command_chat').catch(console.error);

        // ── Handle create_mission: hand off to Inngest background job ──
        // generateMissionJSON can take 45-90s for complex missions.
        // Running it inline would hit the 120s serverless timeout — so we fire
        // an Inngest event and let the background function handle it. The client
        // polls /api/blueprint-status?jobId=... for progress and completion.
        if (actionPayload?.type === 'create_mission' && actionPayload.intent) {
          const jobId = crypto.randomUUID();
          try {
            const { inngest } = await import('@/lib/inngest/client');
            await inngest.send({
              name: 'mission/blueprint.generate',
              data: { jobId, intent: actionPayload.intent as string, tenantId },
            });
            actionPayload = { type: 'building_blueprint', jobId };
          } catch (inngestErr) {
            console.error('[command-chat] Failed to queue blueprint generation:', inngestErr);
            actionPayload = { type: 'mission_create_error', error: (inngestErr as Error).message };
          }
        }

        // Persist messages
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

        send({ type: 'done', credits, inputTokens, outputTokens, sessionId: chatId, cleanText, action: actionPayload });

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
