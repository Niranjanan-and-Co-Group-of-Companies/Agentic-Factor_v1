import { v4 as uuidv4 } from 'uuid';
import { LLMOutputSchema, MissionSchema, type Mission, type LLMOutput } from '../schemas/mission';
import { createServiceClient } from '../supabase/server';
import { callLLM, generateEmbedding } from './llm-router';
import { robustJSONParse, safeJSONParse } from '../utils/json-parser';

// ============================================================
// Permission Normalizer — maps free-form service names to exact provider keys
// This is a safety net: the LLM prompt already constrains the output,
// but LLMs can still hallucinate full API names.
// ============================================================
const KNOWN_PROVIDERS = [
  'google', 'twitter', 'facebook', 'instagram', 'linkedin_oidc',
  'slack', 'github', 'notion', 'discord', 'zoho',
  'whatsapp', 'messenger', 'azure', 'teams', 'stripe', 'shopify',
] as const;

// Keywords → provider mappings. Order matters: more specific matches first.
const PROVIDER_KEYWORDS: Array<{ keywords: string[]; provider: string }> = [
  { keywords: ['twitter', 'tweet', 'x.com', 'x/twitter', 'twitter/x'], provider: 'twitter' },
  { keywords: ['instagram', 'insta', 'ig '], provider: 'instagram' },
  { keywords: ['facebook', 'fb ', 'graph api', 'meta '], provider: 'facebook' },
  { keywords: ['whatsapp', 'whats app'], provider: 'whatsapp' },
  { keywords: ['messenger', 'fb messenger'], provider: 'messenger' },
  { keywords: ['linkedin', 'linked in'], provider: 'linkedin_oidc' },
  { keywords: ['slack'], provider: 'slack' },
  { keywords: ['github', 'git hub'], provider: 'github' },
  { keywords: ['notion'], provider: 'notion' },
  { keywords: ['discord'], provider: 'discord' },
  { keywords: ['zoho'], provider: 'zoho' },
  { keywords: ['azure', 'microsoft azure'], provider: 'azure' },
  { keywords: ['teams', 'microsoft teams'], provider: 'teams' },
  { keywords: ['stripe'], provider: 'stripe' },
  { keywords: ['shopify'], provider: 'shopify' },
  { keywords: ['google', 'gmail', 'gdrive', 'google drive', 'google calendar', 'google sheets', 'gcp', 'workspace'], provider: 'google' },
];

/**
 * Normalizes a single service name to a known provider key.
 * Returns the original value if no match is found (for truly unknown connectors).
 */
function normalizeServiceName(service: string): string {
  const lower = service.toLowerCase().trim();

  // 1. Exact match — already a valid provider key
  if ((KNOWN_PROVIDERS as readonly string[]).includes(lower)) {
    return lower;
  }

  // 2. Keyword fuzzy match
  for (const { keywords, provider } of PROVIDER_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return provider;
      }
    }
  }

  // 3. No match — return as-is (will be caught by the "unknown connector" admin flow)
  console.warn(`[Normalizer] Unknown service "${service}" — no provider match found, keeping as-is`);
  return lower.replace(/\s+/g, '_');
}

/**
 * Normalizes all permission service names in a blueprint.
 * Also deduplicates permissions that resolve to the same provider + type.
 */
function normalizePermissions(permissions: Array<{ type: string; service: string; scope: string; confidentialityLevel: string }>): typeof permissions {
  const seen = new Set<string>();
  const normalized: typeof permissions = [];

  for (const perm of permissions) {
    const originalService = perm.service;
    const normalizedService = normalizeServiceName(perm.service);
    const dedupeKey = `${perm.type}:${normalizedService}`;

    if (originalService !== normalizedService) {
      console.log(`[Normalizer] Mapped permission "${originalService}" → "${normalizedService}"`);
    }

    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      normalized.push({ ...perm, service: normalizedService });
    }
  }

  return normalized;
}

// ============================================================
// System prompt for the LLM intake engine
// ============================================================
const SYSTEM_PROMPT = `You are the Intake Engine for a SaaS Agentic Factor platform.
Your job is to convert a user's natural language description of a task into a structured Mission JSON.

You must decompose the user's intent into:
1. **Agent Roles (Smart Decomposition)**: Break the user's task into the MINIMUM number of agents needed for success. Combine related capabilities into single agents wherever possible. RULES:
   - Simple tasks (research + email): 2-3 agents MAX
   - Medium tasks (multi-step workflows): 3-5 agents
   - Complex tasks (HR pipelines, code reviews): 5-8 agents
   - NEVER create a 'Summary Reporter' agent — the last functional agent IS the final output
   - NEVER create separate agents for 'formatting' and 'sending' — combine them
   - Merge agents that just pass data without transforming it
   - Each agent should do MEANINGFUL work, not just relay data
2. **Capabilities**: What each agent can do (e.g., "read_cloudwatch", "send_slack", "query_database").
3. **requiresExternalData**: Set to true if the agent needs to research/fetch external information.
4. **Tools**: External services each agent needs. Each tool MUST have:
   - "name": string (e.g., "Slack API")
   - "type": one of EXACTLY these values: "api", "database", "file_system", "notification", "web_search", "llm_reasoning", "social_media", "scraping", "crm", "analytics", "messaging"
   - "requiresAuth": boolean
   - "confidentialityLevel": one of "public", "internal", "confidential", "restricted"
5. **Handoff Protocol**: For each agent, define a strict "handoffProtocol" string explaining exactly what input data format it requires from the previous agent, and what output format it must produce for the next agent.
6. **pythonScript (VITAL)**: For each agent, you MUST generate the actual, executable Python 3.11 code that implements the agent's logic. 
   - **CRITICAL**: NEVER generate mock data, placeholder variables, or simulated API calls. You MUST write the exact, production-ready Python code to execute real HTTP requests using libraries like 'requests'. If you output mock data, the mission will fail.
   - DO NOT use fragile DOM scraping (BeautifulSoup, etc.) unless absolutely necessary.
   - PREFER WebMCP (Model Context Protocol) or Semantic APIs for data extraction.
   - If an API is unavailable, prefer Vision Models to "read" the page.
   - **READING INPUT FROM PREVIOUS AGENTS**: The script MUST read input from the INPUT_CONTEXT environment variable: \`input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))\`. Do NOT use sys.stdin.read(). The \`_input\` and \`_input_data\` variables are also pre-set with the raw string and parsed JSON respectively.
   - The script must print its final output to \`sys.stdout\` as a JSON string.
   - **CRITICAL: DO NOT EMPTY THE BUCKET.** The script MUST parse the input JSON and merge its new output into it. If the previous agent generated a newsletter, keep it in the final JSON alongside your new status receipts so the final output contains ALL accumulated content.
   - **NEVER use sys.exit().** E2B sandbox treats ANY sys.exit() as a crash. Use print(json.dumps({...})) to output and let the script end naturally.
   - **PRE-INSTALLED SDK MODULES** — Use these instead of raw HTTP requests:
     - \`from agenticfactor import social\` — Social media posting (ALWAYS use this for Twitter/Facebook/Instagram/LinkedIn):
       - \`social.post_tweet(text)\` → Post a tweet (auto-handles Twitter API v2)
       - \`social.get_tweets(query)\` → Search recent tweets
       - \`social.get_twitter_user_me()\` → Get authenticated Twitter user profile
       - \`social.get_facebook_pages()\` → List managed Facebook Pages (returns [{id, name, access_token}])
       - \`social.post_facebook(page_id, message)\` → Post to a Facebook Page (auto-fetches page token)
       - \`social.get_instagram_accounts()\` → List Instagram Business accounts
       - \`social.post_instagram(ig_user_id, image_url, caption)\` → Post to Instagram
       - \`social.post_linkedin(text)\` → Post to LinkedIn
       - \`social.post_to_all(text, platforms=["twitter","facebook"])\` → Multi-platform post
     - \`from agenticfactor import api\` — Universal API caller for any provider:
       - \`api.call(provider, method, endpoint, params, json_data)\` — Always use full URLs or relative paths (base URLs auto-resolved)
       - \`api.slack_send(channel, text)\` — Send Slack message
       - \`api.github_create_issue(owner, repo, title, body)\` — Create GitHub issue
       - \`api.notion_create_page(parent_id, title, content)\` — Create Notion page
     - \`from agenticfactor._core import ask_user, notify_user\` — Interactive signals
7. **Orchestration Pattern**: Choose the optimal pattern:
   - "sequential" — linear pipeline (A → B → C)
   - "parallel" — fan-out/gather (A+B+C → D)
   - "orchestrator_worker" — supervisor delegates to workers
   - "hierarchical" — nested teams
8. **timeoutSeconds**: How long agents can be idle before deadlock detection (default 300).
9. **Validation Checklist**: 3-8 specific assertions to verify the mission output quality.
10. **Permissions**: All credentials the agents will need. Each permission MUST have:
   - "type": one of "api_key", "oauth_token", "database_credential", "file_access", "service_account", "webhook"
   - "service": MUST be one of these EXACT provider keys (case-sensitive): "google", "twitter", "facebook", "instagram", "linkedin_oidc", "slack", "github", "notion", "discord", "zoho", "whatsapp", "messenger", "azure", "teams", "stripe", "shopify". Do NOT use full names like "Twitter/X OAuth 2.0 PKCE" or "Facebook Graph API" — use ONLY the short key.
   - "scope": string (e.g., "tweet.write", "pages_manage_posts", "chat:write")
   - "confidentialityLevel": one of "public", "internal", "confidential", "restricted"
11. **Discovery Questions**: Generate 3 or more highly specific "discoveryQuestions" to ask the user. These questions must gather missing context or exact preferences needed to refine the agents' system prompts before deployment.
12. **Expected Output Format**: Generate a highly specific string ("expectedOutputFormat") containing a sample format of what the final output should look like based on the user's request. This will be shown to the user so they can edit it. If it's a JSON array, provide an example array. If it's a markdown report, provide a sample markdown skeleton.

IMPORTANT RULES:
- Each agent must have a unique agentIndex starting from 0.
- The orchestration.edges array must define valid connections using "agent-0", "agent-1", etc.
- Every agent that accesses external APIs or data sources must set requiresExternalData: true.
- The validationChecklist must contain actionable, testable assertions.
- Tool types MUST be from the allowed list above. Do NOT invent new types.
- Permission "service" values MUST be exact provider keys from the list above. Using full API names will break the system.
- NEVER use sys.exit() in pythonScript — the sandbox crashes on it. Let scripts end naturally.
- For social media tasks, ALWAYS use the agenticfactor.social module — NEVER write raw API calls.

Respond ONLY with valid JSON matching the schema. No markdown, no explanation.`;

// ============================================================
// Few-shot examples for common mission types
// ============================================================
const FEW_SHOT_EXAMPLES = `
Example 0 — User says: "Post Hello World to my Facebook Page"
{
  "title": "Post to Facebook Page",
  "description": "Posts a message to the user's Facebook Page using the agenticfactor SDK.",
  "agents": [
    {
      "agentIndex": 0,
      "role": "Facebook Page Publisher",
      "capabilities": ["post_facebook"],
      "requiresExternalData": true,
      "tools": [{"name": "Facebook Graph API", "type": "social_media", "requiresAuth": true, "confidentialityLevel": "internal"}],
      "systemPrompt": "You post content to Facebook Pages using the agenticfactor.social SDK.",
      "handoffProtocol": "Output: { 'page_id': string, 'post_id': string, 'message': string, 'status': 'posted' | 'failed' }",
      "pythonScript": "import json, os\nfrom agenticfactor import social\n\ninput_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))\ntry:\n    pages = social.get_facebook_pages()\n    if not pages:\n        print(json.dumps({**input_data, 'status': 'failed', 'error': 'No Facebook Pages found'}))\n    else:\n        page = pages[0]\n        result = social.post_facebook(page['id'], 'Hello World from Agentic Factor! 🚀')\n        print(json.dumps({**input_data, 'status': 'posted', 'page_id': page['id'], 'page_name': page['name'], 'post_id': result.get('id', ''), 'message': 'Hello World from Agentic Factor! 🚀'}))\nexcept Exception as e:\n    print(json.dumps({**input_data, 'status': 'failed', 'error': str(e)}))"
    }
  ],
  "orchestration": {
    "pattern": "sequential",
    "timeoutSeconds": 120,
    "edges": []
  },
  "validationChecklist": [
    "Facebook OAuth token is valid",
    "At least one Facebook Page is accessible",
    "Post was successfully created on the Page"
  ],
  "expectedOutputFormat": "{\\n  \\\"status\\\": \\\"posted\\\",\\n  \\\"page_id\\\": \\\"123\\\",\\n  \\\"post_id\\\": \\\"456\\\"\\n}",
  "permissions": [
    {"type": "oauth_token", "service": "facebook", "scope": "pages_manage_posts", "confidentialityLevel": "internal"}
  ],
  "discoveryQuestions": [
    "Which Facebook Page should the post go to?",
    "What message would you like to post?"
  ]
}

Example 1 — User says: "Monitor my AWS costs and alert on Slack if spending exceeds $1000/day"
{
  "title": "AWS Cost Monitor with Slack Alerts",
  "description": "Monitors AWS CloudWatch billing metrics and sends Slack alerts when daily spend exceeds threshold.",
  "agents": [
    {
      "agentIndex": 0,
      "role": "AWS Cost Monitor",
      "capabilities": ["read_cloudwatch", "analyze_billing"],
      "requiresExternalData": true,
      "tools": [{"name": "AWS CloudWatch", "type": "api", "requiresAuth": true, "confidentialityLevel": "confidential"}],
      "systemPrompt": "You monitor AWS CloudWatch billing metrics. Fetch daily cost data and flag when spending exceeds the configured threshold.",
      "handoffProtocol": "Output MUST be a JSON object containing { 'thresholdExceeded': boolean, 'currentSpend': number, 'breakdown': string }.",
      "pythonScript": "import sys, json, os\\n\\ninput_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))\\ntry:\\n  aws_token = os.environ.get('AWS_ACCESS_TOKEN')\\n  headers = {'Authorization': f'Bearer {aws_token}'}\\n  resp = requests.get('https://monitoring.us-east-1.amazonaws.com/billing', headers=headers)\\n  data = resp.json()\\n  current = data.get('daily_spend', 0)\\n  print(json.dumps({'thresholdExceeded': current > 1000, 'currentSpend': current, 'breakdown': data.get('breakdown', '')}))\\nexcept Exception as e:\\n  print(json.dumps({'error': str(e)}))"
    },
    {
      "agentIndex": 1,
      "role": "Slack Notifier",
      "capabilities": ["send_slack", "format_message"],
      "requiresExternalData": false,
      "tools": [{"name": "Slack API", "type": "notification", "requiresAuth": true, "confidentialityLevel": "internal"}],
      "systemPrompt": "You send formatted alert messages to the configured Slack channel when triggered by the cost monitor.",
      "handoffProtocol": "Input MUST be the JSON object from the Cost Monitor. Do not execute if thresholdExceeded is false.",
      "pythonScript": "import sys, json, os\\n\\ninput_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))\\ntry:\\n  data = input_data\\n  if data.get('thresholdExceeded'):\\n    print(json.dumps({'status': 'sent', 'channel': '#alerts'}))\\nexcept:\\n  print(json.dumps({'error': 'invalid input'}))"
    }
  ],
  "orchestration": {
    "pattern": "sequential",
    "timeoutSeconds": 300,
    "edges": [{"from": "agent-0", "to": "agent-1"}]
  },
  "validationChecklist": [
    "AWS CloudWatch API connection is valid",
    "Cost data is retrieved for the correct AWS account",
    "Slack channel is accessible and writable",
    "Alert threshold is correctly configured at $1000/day",
    "Alert message contains cost breakdown"
  ],
  "expectedOutputFormat": "{\\n  \\"status\\": \\"sent\\",\\n  \\"channel\\": \\"#alerts\\"\\n}",
  "permissions": [
    {"type": "api_key", "service": "AWS", "scope": "cloudwatch:read", "confidentialityLevel": "confidential"},
    {"type": "oauth_token", "service": "Slack", "scope": "chat:write", "confidentialityLevel": "internal"}
  ],
  "discoveryQuestions": [
    "What specific AWS accounts or regions should the monitor focus on?",
    "Which Slack channel should receive the alerts, and who should be tagged?",
    "Should the alert include a specific timeframe breakdown (e.g., last 24h vs last 7 days)?"
  ]
}`;

// ============================================================
// Vector Memory: Search for similar past missions
// ============================================================
async function searchSimilarMissions(
  intent: string,
  tenantId: string
): Promise<string> {
  try {
    // Generate embedding for the user's intent
    const embedding = await generateEmbedding(intent);
    if (!embedding) return ''; // No embedding provider available
    const supabase = createServiceClient();

    // Search for similar mission patterns via pgvector
    const { data: patterns, error } = await supabase.rpc('match_mission_patterns', {
      query_embedding: embedding,
      match_tenant_id: tenantId,
      match_threshold: 0.75,
      match_count: 3,
    });

    if (error || !patterns?.length) {
      return '';
    }

    // Format as context for the LLM
    const context = patterns
      .map(
        (p: { pattern_summary: string; orchestration_pattern: string; agent_count: number; success_score: number }) =>
          `- Pattern: ${p.pattern_summary} (${p.orchestration_pattern}, ${p.agent_count} agents, score: ${p.success_score})`
      )
      .join('\n');

    return `\n\nSimilar successful missions from this tenant:\n${context}\nUse these as reference for agent structure and orchestration.`;
  } catch {
    // Vector memory is optional — gracefully degrade
    return '';
  }
}

// ============================================================
// Phase 2.1: Global Tenant Memory (Extract and Retrieve)
// ============================================================
async function extractAndSaveTenantMemory(intent: string, tenantId: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    const llmResponse = await callLLM([
      { role: 'system', content: 'Extract reusable company facts, preferences, credentials, or policies from the user prompt. Ignore specific task instructions. Only extract global facts. Return JSON: { "facts": ["fact 1", "fact 2"] }' },
      { role: 'user', content: intent }
    ], { jsonMode: true, temperature: 0.1, tier: 2, budgetContext: { tenantId, missionId: 'blueprint_generation' } });
    
    const data: any = safeJSONParse(llmResponse.content, { facts: [] });
    if (data.facts && data.facts.length > 0) {
      for (const fact of data.facts) {
        await supabase.from('tenant_memory').insert({ tenant_id: tenantId, fact });
      }
      console.log(`[intake] Extracted ${data.facts.length} global facts for tenant ${tenantId}`);
    }
  } catch (e) {
    console.warn('[intake] Failed to extract tenant memory', e);
  }
}

async function retrieveTenantMemory(tenantId: string): Promise<string> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase.from('tenant_memory').select('fact').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(20);
    if (data && data.length > 0) {
      const facts = data.map(d => `- ${d.fact}`).join('\n');
      return `\n\nGLOBAL TENANT MEMORY (Company Policies - ALWAYS OBEY):\n${facts}`;
    }
    return '';
  } catch {
    return '';
  }
}

// ============================================================
// Core: Generate Mission JSON from natural language
// ============================================================
export async function generateMissionJSON(
  intent: string,
  tenantId: string
): Promise<{ mission?: Mission; rawLLMOutput?: LLMOutput; isDiscovery?: boolean; question?: string }> {
  // ── Parallelized initial calls (saves ~5-10 seconds) ──
  const { getPlanConfig } = await import('@/lib/middleware/billing');
  
  // Run ALL pre-checks in parallel instead of sequentially
  const [memoryContext, globalMemory, planConfig] = await Promise.all([
    searchSimilarMissions(intent, tenantId),
    retrieveTenantMemory(tenantId),
    getPlanConfig(tenantId),
  ]);

  // Extract facts in the background (fire-and-forget)
  extractAndSaveTenantMemory(intent, tenantId).catch(console.error);

  // Phase 2.2: Plan-Aware Discovery Loop
  const maxQ = planConfig.maxClarifications;

  const discoveryPrompts: Record<number, string> = {
    2:  'You are a quick intake assistant. Ask only if truly critical details are missing. Be forgiving of vagueness — infer reasonable defaults. Return {\"ready\": true} unless the intent is genuinely unusable.',
    4:  'You are a thorough Solutions Architect. Analyze the intent carefully. If key requirements are missing (target platform, success metrics, data sources), ask ONE precise clarifying question. Do NOT re-ask anything the user has already provided in the intent. Return {\"ready\": false, \"question\": \"...\"} or {\"ready\": true}.',
    6:  'You are a senior Enterprise Solutions Architect. Analyze the intent deeply. Identify gaps in scope, edge cases, constraints, target audience, data formats, and success criteria. Ask ONE highly specific, non-redundant question. Never ask generic questions — every question must directly improve agent accuracy. Do NOT re-ask anything already stated. Return {\"ready\": false, \"question\": \"...\"} or {\"ready\": true}.',
    10: 'You are the Chief Architect at a top consulting firm. Perform exhaustive requirements discovery. Leave NOTHING to assumption. Cover: exact scope, success metrics, edge cases, error handling, data formats, target demographics, compliance requirements, integration specifics, output format expectations, and rollback criteria. Ask ONE laser-focused question per round. Never repeat or rephrase a previously answered question. Return {\"ready\": false, \"question\": \"...\"} or {\"ready\": true}.',
  };

  const promptKey = maxQ <= 2 ? 2 : maxQ <= 4 ? 4 : maxQ <= 6 ? 6 : 10;

  const discoveryCheck = await callLLM([
    { role: 'system', content: discoveryPrompts[promptKey] },
    { role: 'user', content: `Intent: ${intent}${globalMemory}` }
  ], { jsonMode: true, temperature: 0.1, tier: 2, budgetContext: { tenantId, missionId: 'blueprint_generation' } });
  
  let discoveryData;
  try {
    discoveryData = robustJSONParse(discoveryCheck.content);
  } catch {
    console.warn('[intake] Discovery check returned non-JSON, skipping discovery');
    discoveryData = { ready: true };
  }
  if (!discoveryData.ready && discoveryData.question) {
    return { isDiscovery: true, question: discoveryData.question as string };
  }

  // 2. Call LLM with system prompt + intent + memory context
  const llmResponse = await callLLM([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Examples for reference:\n${FEW_SHOT_EXAMPLES}` },
    {
      role: 'user',
      content: `Generate a Mission JSON for the following intent:\n\n"${intent}"${memoryContext}${globalMemory}`,
    },
  ], { temperature: 0.3, jsonMode: true, tier: 1, budgetContext: { tenantId, missionId: 'blueprint_generation' } }); // Tier 1 for complex code generation

  console.log(`[intake] LLM provider: ${llmResponse.provider}, tokens: ${llmResponse.tokensUsed}`);

  // ── JSON Auto-Retry with Local Repair ──
  // Step 1: Try parsing as-is
  // Step 2: Try local JSON repair (free, no LLM call)
  // Step 3: Retry LLM with error context (costs credits)
  let rawJSON: Record<string, unknown>;
  
  try {
    rawJSON = robustJSONParse(llmResponse.content);
  } catch (parseError1) {
    console.warn(`[intake] JSON parse failed, attempting local repair...`);
    
    // Step 2: Local JSON repair — fix common LLM JSON mistakes
    try {
      let repaired = llmResponse.content;
      // Remove markdown code block wrappers
      repaired = repaired.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      // Remove trailing commas before ] or }
      repaired = repaired.replace(/,\s*([}\]])/g, '$1');
      // Fix missing commas between array elements or object properties
      repaired = repaired.replace(/}\s*{/g, '},{');
      repaired = repaired.replace(/"\s*\n\s*"/g, '",\n"');
      // Try to close unclosed brackets
      const openBraces = (repaired.match(/{/g) || []).length;
      const closeBraces = (repaired.match(/}/g) || []).length;
      const openBrackets = (repaired.match(/\[/g) || []).length;
      const closeBrackets = (repaired.match(/\]/g) || []).length;
      repaired += '}'.repeat(Math.max(0, openBraces - closeBraces));
      repaired += ']'.repeat(Math.max(0, openBrackets - closeBrackets));
      
      rawJSON = robustJSONParse(repaired);
      console.log(`[intake] Local JSON repair succeeded!`);
    } catch (repairError) {
      console.warn(`[intake] Local repair failed, retrying LLM...`);
      
      // Step 3: Retry LLM with error context
      const retryResponse = await callLLM([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Generate a Mission JSON for: "${intent}"${memoryContext}${globalMemory}` },
        { role: 'assistant', content: llmResponse.content.substring(0, 2000) },
        { role: 'user', content: `Your previous response had a JSON syntax error: ${(parseError1 as Error).message}. Please regenerate the COMPLETE valid JSON response. Respond with ONLY valid JSON, no markdown.` }
      ], { temperature: 0.1, jsonMode: true, tier: 1, budgetContext: { tenantId, missionId: 'blueprint_retry' } });
      
      console.log(`[intake] LLM retry provider: ${retryResponse.provider}, tokens: ${retryResponse.tokensUsed}`);
      
      try {
        rawJSON = robustJSONParse(retryResponse.content);
        console.log(`[intake] LLM retry succeeded!`);
      } catch (parseError2) {
        // Last attempt: clean the retry response too
        let cleaned = retryResponse.content;
        cleaned = cleaned.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
        cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
        rawJSON = robustJSONParse(cleaned); // If this fails, the error propagates to the user
      }
    }
  }

  // 3. Validate LLM output against schema
  const llmOutput = LLMOutputSchema.parse(rawJSON);

  // 3.5 Normalize permission service names (safety net for LLM hallucinations)
  if (llmOutput.permissions?.length > 0) {
    llmOutput.permissions = normalizePermissions(llmOutput.permissions as any) as any;
  }

  // 4. Hydrate with IDs, tenantId, timestamps
  const now = new Date().toISOString();
  const missionId = uuidv4();

  // Assign UUIDs to agents and fix orchestration references
  const agentIdMap = new Map<string, string>();
  const hydratedAgents = llmOutput.agents.map((agent, index) => {
    const agentId = uuidv4();
    agentIdMap.set(`agent-${index}`, agentId);
    if (agent.id) agentIdMap.set(agent.id, agentId);
    return {
      ...agent,
      id: agentId,
      agentIndex: index,
      systemPrompt: agent.systemPrompt || `You are ${agent.role}. Execute your assigned tasks with precision and thoroughness.`,
      pythonScript: agent.pythonScript || `import sys, json, os\n\n# Read input from previous agent\ninput_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))\nprint(json.dumps({'status': 'executed', 'agent': '${agent.role}'}))`,
    };
  });

  // Resolve edge references to actual agent UUIDs
  const hydratedEdges = llmOutput.orchestration.edges.map((edge) => ({
    from: agentIdMap.get(edge.from) || edge.from,
    to: agentIdMap.get(edge.to) || edge.to,
    condition: edge.condition,
  }));

  const entryAgentId =
    agentIdMap.get(llmOutput.orchestration.entryAgent || 'agent-0') ||
    hydratedAgents[0].id;

  // 5. Build the full Mission object
  const mission: Mission = MissionSchema.parse({
    id: missionId,
    tenantId,
    title: llmOutput.title,
    description: llmOutput.description,
    status: 'draft',
    agents: hydratedAgents,
    orchestration: {
      pattern: llmOutput.orchestration.pattern,
      timeoutSeconds: llmOutput.orchestration.timeoutSeconds,
      entryAgent: entryAgentId,
      edges: hydratedEdges,
    },
    validationChecklist: llmOutput.validationChecklist,
    expectedOutputFormat: llmOutput.expectedOutputFormat,
    permissions: llmOutput.permissions,
    createdAt: now,
    updatedAt: now,
  });

  return { mission, rawLLMOutput: llmOutput };
}

// ============================================================
// Phase 4.2: Edit Blueprint via Chat
// ============================================================
export async function editBlueprint(
  currentBlueprint: Mission,
  instruction: string
): Promise<Mission> {
  const llmResponse = await callLLM([
    { role: 'system', content: 'You are an AI Architect. You will receive a JSON Blueprint of an agent pipeline and a user instruction to modify it. You MUST return ONLY the modified JSON blueprint that exactly matches the LLMOutputSchema format. Apply the modification correctly.' },
    { role: 'user', content: `Current Blueprint:\n${JSON.stringify(currentBlueprint, null, 2)}\n\nInstruction: ${instruction}` }
  ], { jsonMode: true, temperature: 0.2, tier: 1 });

  let rawJSON;
  let llmOutput;
  try {
    rawJSON = robustJSONParse(llmResponse.content);
    llmOutput = LLMOutputSchema.parse(rawJSON);
  } catch (err: any) {
    console.log(`[intake] Edit blueprint failed parsing, attempting heal: ${err.message}`);
    const healResponse = await callLLM([
      { role: 'system', content: 'You are a JSON recovery expert. The following output failed schema validation. Fix the JSON so it perfectly matches the requested schema. Return ONLY valid JSON.' },
      { role: 'user', content: `Bad Output: ${llmResponse.content}\n\nError: ${err.message}` }
    ], { jsonMode: true, temperature: 0.1, tier: 1 });
    
    rawJSON = robustJSONParse(healResponse.content);
    llmOutput = LLMOutputSchema.parse(rawJSON);
  }

  // Normalize permission service names (safety net)
  if (llmOutput.permissions?.length > 0) {
    llmOutput.permissions = normalizePermissions(llmOutput.permissions as any) as any;
  }

  // Preserve UUIDs from the current blueprint where possible, otherwise generate new ones
  // Priority: match by agentIndex (most stable) → then by role name → then by id → fallback to new UUID
  const oldToNewIdMap: Record<string, string> = {};
  
  const hydratedAgents = llmOutput.agents.map((newAgent, i) => {
    // Try to find the matching existing agent
    const existingAgent = 
      currentBlueprint.agents.find(ea => ea.agentIndex === newAgent.agentIndex) ||  // Most stable match
      currentBlueprint.agents.find(ea => ea.role === newAgent.role) ||               // Role name match
      currentBlueprint.agents.find(ea => ea.id === newAgent.id);                     // Direct ID match
    
    const finalId = existingAgent?.id || crypto.randomUUID();
    
    // Track ID mappings so we can remap edges
    if (newAgent.id && newAgent.id !== finalId) {
      oldToNewIdMap[newAgent.id] = finalId;
    }
    // Also map the generic agent-N reference
    oldToNewIdMap[`agent-${i}`] = finalId;
    
    return {
      ...newAgent,
      id: finalId,
      agentIndex: i, // Ensure sequential indices
    };
  }) as any;

  // Remap orchestration edges to use the correct UUIDs
  const remappedEdges = (llmOutput.orchestration.edges || []).map(edge => ({
    ...edge,
    from: oldToNewIdMap[edge.from] || edge.from,
    to: oldToNewIdMap[edge.to] || edge.to,
  }));

  // Remap entryAgent
  const remappedEntryAgent = oldToNewIdMap[llmOutput.orchestration.entryAgent || 'agent-0'] 
    || llmOutput.orchestration.entryAgent 
    || hydratedAgents[0]?.id;

  const mission: Mission = {
    ...currentBlueprint,
    ...llmOutput,
    agents: hydratedAgents,
    orchestration: {
      ...llmOutput.orchestration,
      edges: remappedEdges,
      entryAgent: remappedEntryAgent,
    },
  };

  return mission;
}

// ============================================================
// Persist mission to Supabase (RLS-scoped)
// ============================================================
export async function persistMission(
  mission: Mission,
  tenantId: string
): Promise<Mission> {
  const supabase = createServiceClient();

  // 1. Insert mission — let DB generate ID if we send undefined (by stripping it)
  // Wait, if we strip it, we need to get it back.
  const { data: missionData, error: missionError } = await supabase.from('missions').insert({
    tenant_id: tenantId,
    title: mission.title,
    description: mission.description,
    status: 'active',
    mission_json: mission, // Will update this after agent IDs are generated
    heartbeat_at: new Date().toISOString(),
  }).select('id').single();

  if (missionError || !missionData) {
    throw new Error(`Failed to persist mission: ${missionError?.message}`);
  }

  const finalMissionId = missionData.id;
  mission.id = finalMissionId;

  // 2. Insert agents — strip ID so Supabase generates it
  if (mission.agents.length > 0) {
    const agentRows = mission.agents.map((agent) => ({
      tenant_id: tenantId,
      mission_id: finalMissionId,
      role: agent.role,
      agent_index: agent.agentIndex,
      status: 'running',
      capabilities: agent.capabilities,
      requires_external_data: agent.requiresExternalData,
      system_prompt: agent.systemPrompt || `You are ${agent.role}. Execute your assigned tasks.`,
      config: { tools: agent.tools, trustLevel: 'conditional' },
    }));

    const { data: insertedAgents, error: agentError } = await supabase
      .from('agents')
      .insert(agentRows)
      .select('id, agent_index');

    if (agentError) {
      console.error('[persist] Agent insert failed:', agentError.message);
    } else if (insertedAgents) {
      // Map generated DB UUIDs back to the mission object and orchestration graph
      const idMapping: Record<string, string> = {};

      insertedAgents.forEach((row) => {
        const matchingAgent = mission.agents.find(a => a.agentIndex === row.agent_index);
        if (matchingAgent) {
          if (matchingAgent.id) {
            idMapping[matchingAgent.id] = row.id;
          }
          matchingAgent.id = row.id;
        }
      });

      // Update the orchestration graph with the new DB UUIDs
      if (mission.orchestration) {
        if (mission.orchestration.entryAgent && idMapping[mission.orchestration.entryAgent]) {
          mission.orchestration.entryAgent = idMapping[mission.orchestration.entryAgent];
        }

        if (mission.orchestration.edges) {
          mission.orchestration.edges.forEach((edge) => {
            if (idMapping[edge.from]) edge.from = idMapping[edge.from];
            if (idMapping[edge.to]) edge.to = idMapping[edge.to];
          });
        }
      }
    }
  }

  // 3. Update the mission_json now that we have all true UUIDs
  await supabase.from('missions').update({
    mission_json: mission
  }).eq('id', finalMissionId);

  // Insert permission requirements
  if (mission.permissions.length > 0) {
    const permRows = mission.permissions.map((perm) => ({
      tenant_id: tenantId,
      mission_id: mission.id,
      type: perm.type,
      service: perm.service,
      scope: perm.scope,
      confidentiality_level: perm.confidentialityLevel,
      granted: false,
    }));

    const { error: permError } = await supabase.from('permissions').insert(permRows);
    if (permError) {
      console.error('[persist] Permissions insert failed:', permError.message);
    }
  }

  // Log event
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'mission.created',
    entity_type: 'mission',
    entity_id: finalMissionId,
    payload: {
      title: mission.title,
      agentCount: mission.agents.length,
      pattern: mission.orchestration.pattern,
      permissionsRequired: mission.permissions.length,
    },
  });

  return mission;
}
