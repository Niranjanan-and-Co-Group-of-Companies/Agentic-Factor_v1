import { v4 as uuidv4 } from 'uuid';

// ============================================================
// Mission Templates — Structure Guides for LLM
// Templates provide STRUCTURE (agents, tools, permissions) as reference.
// The LLM customizes actual Python CODE based on customer's request.
// Templates do NOT contain hardcoded scripts — they guide the LLM.
// ============================================================

export interface TemplateMatch {
  templateId: string;
  confidence: number;
  template: TemplateConfig;
}

interface TemplateConfig {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  category: string;
  agents: Array<{
    role: string;
    capabilities: string[];
    requiresExternalData: boolean;
    tools: Array<{ name: string; type: string; requiresAuth: boolean; confidentialityLevel: string }>;
    systemPrompt: string;
    handoffProtocol: string;
  }>;
  orchestration: { pattern: string; timeoutSeconds: number };
  permissions: Array<{ type: string; service: string; scope: string; confidentialityLevel: string }>;
  validationChecklist: string[];
  discoveryQuestions: string[];
  referenceHints: string;
}

// ── Template 1: Research + Report + Email ──
const RESEARCH_REPORT_EMAIL: TemplateConfig = {
  id: 'research_report_email',
  title: 'Research & Email Report',
  description: 'Research a topic using the web, compile a detailed report, and email it.',
  keywords: ['research', 'report', 'email', 'find', 'search', 'investigate', 'analyze', 'send email', 'gmail', 'startups', 'companies', 'market', 'competitors', 'trends'],
  category: 'research',
  agents: [
    {
      role: 'Web Researcher & Analyst',
      capabilities: ['web_search', 'data_extraction', 'analysis'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: 'You are a thorough web researcher. Search for information, extract key data points, and compile structured analysis.',
      handoffProtocol: 'Output: JSON with { "query": string, "results": array of findings with name/description/details, "summary": string }',
    },
    {
      role: 'Report Builder & Email Sender',
      capabilities: ['format_html', 'send_email', 'create_spreadsheet'],
      requiresExternalData: true,
      tools: [
        { name: 'Gmail API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' },
        { name: 'Google Sheets API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }
      ],
      systemPrompt: 'You format research results into a professional HTML email and Google Sheet, then send via Gmail.',
      handoffProtocol: 'Input: research results JSON. Output: { "email_sent": boolean, "sheet_url": string, "status": "delivered" }',
    }
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 300 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'oauth_token', service: 'google', scope: 'gmail.send sheets', confidentialityLevel: 'internal' }
  ],
  validationChecklist: [
    'Web search returns relevant results',
    'HTML email is well-formatted',
    'Email is sent successfully via Gmail',
    'Google Sheet contains structured data'
  ],
  discoveryQuestions: [
    'What specific topic or query should I research?',
    'How many results do you want in the report?',
    'Should I include a Google Sheet with the raw data?'
  ],
  referenceHints: `For research + email missions:
- Use Tavily 'advanced' search depth with max_results: 10-15 for comprehensive data
- Extract specific email address from the user's intent if mentioned (e.g., "email to niranjanant7@gmail.com")
- If no email in intent, use os.environ.get('USER_EMAIL') as fallback
- Create Google Sheet columns that match the SPECIFIC data the user asked for (e.g., if they want VCs: VC Name, Fund, Portfolio, Stage — NOT generic #, Title, URL)
- Always merge previous agent's output with **input_data spread
- For email HTML: use professional styling with the user's specific data, not generic placeholders
- Print final output as JSON to stdout`
};

// ── Template 2: Content Creation + Email ──
const CONTENT_CREATION: TemplateConfig = {
  id: 'content_creation',
  title: 'Content Creation & Delivery',
  description: 'Research a topic, write professional content, and deliver via email.',
  keywords: ['write', 'content', 'article', 'blog', 'post', 'newsletter', 'draft', 'copy', 'create content', 'write about', 'compose'],
  category: 'content',
  agents: [
    {
      role: 'Research & Content Writer',
      capabilities: ['web_search', 'content_writing'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: 'You research a topic and write professional, engaging content based on your findings.',
      handoffProtocol: 'Output: { "topic": string, "content": string (HTML formatted), "sources": array, "word_count": number }',
    },
    {
      role: 'Email Deliverer',
      capabilities: ['send_email'],
      requiresExternalData: true,
      tools: [{ name: 'Gmail API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }],
      systemPrompt: 'You deliver the written content via Gmail to the user.',
      handoffProtocol: 'Input: content HTML. Output: { "email_sent": boolean, "status": "delivered" }',
    }
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 300 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'oauth_token', service: 'google', scope: 'gmail.send', confidentialityLevel: 'internal' }
  ],
  validationChecklist: ['Content is well-written and relevant', 'Sources are cited', 'Email delivered successfully'],
  discoveryQuestions: ['What topic should the content cover?', 'What tone — formal, casual, or technical?', 'How long should the content be?'],
  referenceHints: `For content creation missions:
- Use Tavily to research the topic before writing
- Write the content as proper HTML with headings, paragraphs, and formatting
- Include source citations as links
- Deliver via Gmail with the content embedded in the email body
- Extract the user's specific content requirements (tone, length, audience)`
};

// ── Template 3: Data Collection + Summary ──
const DATA_COLLECTION: TemplateConfig = {
  id: 'data_collection',
  title: 'Data Collection & Summary',
  description: 'Collect data from the web, process it into a structured format, and email a summary.',
  keywords: ['data', 'collect', 'scrape', 'gather', 'list', 'compile', 'extract', 'find all', 'get me', 'pricing', 'comparison', 'summary'],
  category: 'data',
  agents: [
    {
      role: 'Data Collector & Processor',
      capabilities: ['web_search', 'data_extraction', 'processing'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: 'You collect structured data from web searches and organize it into a clean dataset.',
      handoffProtocol: 'Output: { "query": string, "data": array of objects, "total": number, "summary": string }',
    },
    {
      role: 'Report & Email Sender',
      capabilities: ['format_report', 'send_email', 'create_spreadsheet'],
      requiresExternalData: true,
      tools: [
        { name: 'Gmail API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' },
        { name: 'Google Sheets API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }
      ],
      systemPrompt: 'You create a summary report from collected data and email it with a Google Sheet.',
      handoffProtocol: 'Input: data array. Output: { "email_sent": boolean, "sheet_url": string, "status": "delivered" }',
    }
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 300 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'oauth_token', service: 'google', scope: 'gmail.send sheets', confidentialityLevel: 'internal' }
  ],
  validationChecklist: ['Data is collected and structured', 'Summary is accurate', 'Email sent with report', 'Sheet created with raw data'],
  discoveryQuestions: ['What data should I collect?', 'How many results do you need?', 'Do you want a Google Sheet with the raw data?'],
  referenceHints: `For data collection missions:
- Use multiple Tavily search queries to gather comprehensive data
- Structure data into clear columns matching the user's request
- Create a Google Sheet with proper headers for the specific data type
- Include relevance scores or quality indicators where applicable`
};

// ── Template 4: HR Recruitment Pipeline (Complex, Parallel) ──
const HR_RECRUITMENT: TemplateConfig = {
  id: 'hr_recruitment',
  title: 'HR Recruitment Pipeline',
  description: 'End-to-end recruitment: source candidates, screen resumes, rank, draft outreach emails, schedule interviews.',
  keywords: ['recruit', 'hiring', 'candidate', 'resume', 'interview', 'hr', 'talent', 'job', 'position', 'hire', 'recruitment', 'sourcing', 'offer letter', 'headhunt'],
  category: 'hr',
  agents: [
    {
      role: 'Job Requirement Splitter',
      capabilities: ['analysis', 'requirement_extraction'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: 'Parse the hiring request. Extract individual job roles, departments, required skills, experience levels. If multiple positions, split them into separate hiring tracks.',
      handoffProtocol: 'Output: { "positions": [{ "title": string, "department": string, "skills": array, "experience": string }], "total_positions": number }',
    },
    {
      role: 'Candidate Sourcer',
      capabilities: ['web_search', 'candidate_sourcing'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: 'Search for potential candidates matching each position. Use LinkedIn profiles, job boards, and professional networks via web search. Source candidates for ALL positions.',
      handoffProtocol: 'Output: { "sourced": { "position_title": [{ name, profile_url, summary, match_score }] } }',
    },
    {
      role: 'Candidate Screener & Ranker',
      capabilities: ['screening', 'ranking'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: 'Screen and rank sourced candidates per position. Assign tier ratings (A/B/C) based on skill match, experience, and profile quality.',
      handoffProtocol: 'Output: { "ranked": { "position_title": { "tier_a": [...], "tier_b": [...] } } }',
    },
    {
      role: 'Outreach Email Drafter',
      capabilities: ['email_drafting', 'personalization'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: 'Draft personalized outreach emails for Tier A candidates across all positions. Each email should reference the specific role and the candidate profile.',
      handoffProtocol: 'Output: { "draft_emails": [{ candidate_name, position, subject, body_html }] }',
    },
    {
      role: 'Interview Scheduler',
      capabilities: ['calendar_management', 'scheduling'],
      requiresExternalData: true,
      tools: [{ name: 'Google Calendar API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }],
      systemPrompt: 'Propose interview time slots for each Tier A candidate. Group by position/department so interviewers can batch interviews.',
      handoffProtocol: 'Output: { "interview_slots": [{ candidate, position, proposed_times, interviewer_department }] }',
    },
    {
      role: 'Recruitment Tracker Sheet Creator',
      capabilities: ['create_spreadsheet', 'data_organization'],
      requiresExternalData: true,
      tools: [{ name: 'Google Sheets API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }],
      systemPrompt: 'Create a comprehensive recruitment tracking Google Sheet with tabs per position/department. Include all candidates, tiers, contact info, and interview status.',
      handoffProtocol: 'Output: { "sheet_url": string, "tabs_created": number }',
    },
    {
      role: 'Recruitment Report & Email Sender',
      capabilities: ['report_generation', 'send_email'],
      requiresExternalData: true,
      tools: [{ name: 'Gmail API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }],
      systemPrompt: 'Generate final recruitment report summarizing all positions, candidate counts per tier, and next steps. Email the report to the hiring manager.',
      handoffProtocol: 'Output: { "report_sent": boolean, "sheet_url": string, "total_candidates": number, "tier_a_count": number }',
    }
  ],
  orchestration: { pattern: 'parallel', timeoutSeconds: 600 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'oauth_token', service: 'google', scope: 'gmail.send sheets calendar', confidentialityLevel: 'internal' }
  ],
  validationChecklist: [
    'All positions are identified and tracked separately',
    'Candidates are sourced from multiple web sources per position',
    'Screening criteria matches specific job requirements',
    'Tier A candidates are genuine top matches per position',
    'Outreach emails are personalized per candidate and position',
    'Tracking sheet has separate tabs per department/position',
    'Report is comprehensive with per-position breakdowns'
  ],
  discoveryQuestions: [
    'What positions are you hiring for? List all roles and departments.',
    'What are the must-have skills and experience for each position?',
    'Is remote work OK or are positions location-specific?',
    'Who should receive the recruitment report and be assigned as interviewer per department?',
    'How many candidates do you want shortlisted per position?'
  ],
  referenceHints: `For HR recruitment missions:
- ALWAYS use parallel execution when hiring for multiple positions — each position gets its own sourcing/screening pipeline
- For single position: 4-5 agents sequentially. For multiple positions: 7+ agents with parallel sourcing/screening per position
- The Job Splitter agent is critical — it parses the user's request into individual position tracks
- Candidate sourcing uses Tavily to search LinkedIn profiles, job boards, and professional networks
- Create Google Sheet with SEPARATE TABS per position/department
- Interview scheduling should group by department so the right people interview for each role
- The final report should show per-position summaries: how many sourced, how many Tier A, outreach status
- If user mentions specific departments (engineering, marketing, sales), create parallel tracks for each`
};

// ── All Templates ──
const ALL_TEMPLATES: TemplateConfig[] = [
  RESEARCH_REPORT_EMAIL,
  CONTENT_CREATION,
  DATA_COLLECTION,
  HR_RECRUITMENT,
];

/**
 * Match user intent against templates.
 * Returns the best matching template if confidence > threshold.
 */
export function matchTemplate(intent: string): TemplateMatch | null {
  const lower = intent.toLowerCase();
  let bestMatch: TemplateMatch | null = null;

  for (const template of ALL_TEMPLATES) {
    let score = 0;
    let matches = 0;

    for (const keyword of template.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        matches++;
        score += keyword.length;
      }
    }

    const maxPossibleScore = template.keywords.reduce((sum, k) => sum + k.length, 0);
    const confidence = maxPossibleScore > 0 ? (score / maxPossibleScore) * 100 : 0;

    // Require at least 2 keyword matches and 25% confidence
    if (matches >= 2 && confidence > 25 && (!bestMatch || confidence > bestMatch.confidence)) {
      bestMatch = { templateId: template.id, confidence, template };
    }
  }

  return bestMatch;
}

/**
 * Build a template hint string for the LLM.
 * This gives the LLM a head start on agent structure, tools, and permissions.
 * The LLM still generates all the actual code.
 */
export function buildTemplateHint(template: TemplateConfig): string {
  const agentList = template.agents
    .map((a, i) => `  - Agent ${i}: "${a.role}" (${a.capabilities.join(', ')})${a.tools.length > 0 ? ` — Tools: ${a.tools.map(t => t.name).join(', ')}` : ''}`)
    .join('\n');

  const permList = template.permissions
    .map(p => `  - ${p.type}: ${p.service} (${p.scope})`)
    .join('\n');

  return `
═══ TEMPLATE STRUCTURE HINT ═══
The user's request matches a known pattern: "${template.title}"
Here is a REFERENCE agent structure — ADAPT it to the user's SPECIFIC request.
Do NOT copy this blindly. The user's exact requirements take priority.

REFERENCE AGENT STRUCTURE:
${agentList}

REFERENCE ORCHESTRATION: ${template.orchestration.pattern}
REFERENCE TIMEOUT: ${template.orchestration.timeoutSeconds}s

REFERENCE PERMISSIONS:
${permList}

TEMPLATE HINTS (follow these):
${template.referenceHints}

CRITICAL RULES:
1. The agents, their code, and the output format must be customized to match the user's EXACT request
2. If the user mentions specific data fields (e.g., "VC Name, Fund, Stage"), create agents that produce those EXACT fields
3. If the user provides an email address, use THAT address — don't rely on env vars alone
4. If the user asks for a specific number of results (e.g., "find 10"), enforce that in the code
5. The template structure is a SUGGESTION — add or remove agents based on what the user actually needs
6. For HR/hiring missions with multiple positions: use PARALLEL execution with separate sourcing per position
═══ END TEMPLATE HINT ═══`;
}

/**
 * Get all available templates for display.
 */
export function getAvailableTemplates() {
  return ALL_TEMPLATES.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    agentCount: t.agents.length,
    discoveryQuestions: t.discoveryQuestions,
  }));
}
