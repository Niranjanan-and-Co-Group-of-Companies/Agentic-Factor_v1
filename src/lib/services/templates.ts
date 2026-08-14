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

// ── Template 5: Copywriter — Ad Copy + Email Sequence ──
const COPYWRITER_AD_EMAIL: TemplateConfig = {
  id: 'copywriter_ad_email',
  title: 'Ad Copy & Email Sequence Writer',
  description: 'Generate high-converting ad variations and a full email nurture sequence, then save to Notion.',
  keywords: ['copy', 'copywriter', 'ad copy', 'advertisement', 'email sequence', 'nurture', 'drip', 'campaign', 'funnel', 'headline', 'cta', 'conversion', 'landing page', 'facebook ad', 'google ad', 'marketing copy', 'sales copy', 'hook', 'offer', 'persuasive', 'copywriting'],
  category: 'marketing',
  agents: [
    {
      role: 'Market Research & Audience Analyst',
      capabilities: ['web_search', 'audience_research', 'competitive_analysis'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: 'You research the product/service, identify the target audience, analyse competitor messaging, and surface key pain points and desires. You do NOT write copy yet.',
      handoffProtocol: 'Output: { "product_summary": string, "target_persona": object, "pain_points": string[], "desires": string[], "competitor_angles": string[], "unique_value_proposition": string }',
    },
    {
      role: 'Ad Copy Specialist',
      capabilities: ['copywriting', 'ad_creation', 'variant_generation'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: `You are a direct-response copywriter. Using the research brief, write 5 distinct ad variations for the specified platform.
Each variation must use a DIFFERENT hook angle (problem-agitate-solve, social proof, curiosity gap, bold promise, story-based).
For each variation produce: headline (≤30 chars), primary_text (≤125 chars), description (≤20 chars), cta_button label.
All copy must be factual and compliant — no unsubstantiated superlatives, no medical/financial promises without caveats.`,
      handoffProtocol: 'Output: { "platform": string, "variations": [{ "angle": string, "headline": string, "primary_text": string, "description": string, "cta": string }] }',
    },
    {
      role: 'Email Sequence Writer',
      capabilities: ['email_copywriting', 'sequence_planning'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: `You write a 5-email nurture sequence (welcome → education → proof → objection-handling → offer/close).
Each email: subject line, preview text, body HTML (≤400 words, mobile-friendly), and a single clear CTA.
Maintain consistent brand voice and build naturally from one email to the next.
Never use spam trigger words. Never make claims that can't be substantiated.`,
      handoffProtocol: 'Output: { "sequence": [{ "email_number": number, "subject": string, "preview": string, "body_html": string, "cta_text": string, "cta_url_placeholder": string }] }',
    },
    {
      role: 'Notion Deliverer',
      capabilities: ['create_notion_page', 'document_formatting'],
      requiresExternalData: true,
      tools: [{ name: 'Notion API', type: 'composio', requiresAuth: true, confidentialityLevel: 'internal' }],
      systemPrompt: 'Create a structured Notion page with two sections: "Ad Variations" (table with all 5 variants) and "Email Sequence" (each email as a toggle block). Include the audience research summary at the top.',
      handoffProtocol: 'Output: { "notion_page_url": string, "ad_count": number, "email_count": number }',
    }
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 480 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'composio_oauth', service: 'notion', scope: 'write', confidentialityLevel: 'internal' }
  ],
  validationChecklist: [
    'Each ad variation uses a genuinely different hook angle',
    'All copy is compliant — no unsubstantiated claims',
    '5-email sequence follows welcome→education→proof→objection→close arc',
    'Notion page created with both sections and clean formatting',
    'Brand voice is consistent across ads and emails'
  ],
  discoveryQuestions: [
    'Describe your product or service in 2–3 sentences.',
    'Who is your ideal customer? (demographics, role, situation)',
    'What platforms are the ads for? (Facebook/Instagram, Google, LinkedIn)',
    'What action should the ad and email CTA drive? (sign up, book a call, buy now)',
    'What tone — professional, energetic, empathetic, or bold?'
  ],
  referenceHints: `For copywriter missions:
- Research phase is non-negotiable — copy without audience insight is guesswork
- 5 ads minimum, each with a distinct angle (never just length variations)
- Email sequence arc must follow: welcome → value/education → social proof → objection handling → close
- Notion page structure: research brief at top, then ad table, then email sequence toggles
- Check copy for compliance: avoid absolute claims ("guaranteed", "100%"), medical/financial advice, and trigger words
- If the user specifies a niche (e.g., SaaS, e-commerce, coaching), tailor pain points and language accordingly
- The ad specialist should reference real copywriting frameworks: AIDA, PAS, Before-After-Bridge, FOMO`
};

// ── Template 6: SEO Keyword Research & Content Calendar ──
const SEO_KEYWORD_CALENDAR: TemplateConfig = {
  id: 'seo_keyword_calendar',
  title: 'SEO Keyword Research & Content Calendar',
  description: 'Discover high-value keywords, cluster them by intent, draft SEO-optimised article outlines, and export to Google Sheets.',
  keywords: ['seo', 'keyword', 'keyword research', 'search ranking', 'serp', 'organic traffic', 'content calendar', 'blog strategy', 'search intent', 'long-tail', 'meta', 'backlink', 'rank', 'google search', 'content strategy', 'topical authority', 'pillar page', 'cluster'],
  category: 'marketing',
  agents: [
    {
      role: 'Seed Keyword & Competitor Analyst',
      capabilities: ['web_search', 'serp_analysis', 'competitive_research'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: 'Search the web to identify seed keywords and competitor content strategy for the given niche. Analyse SERPs to understand what content is ranking and why. Output a comprehensive seed list with context.',
      handoffProtocol: 'Output: { "niche": string, "seed_keywords": string[], "competitor_domains": string[], "serp_observations": string[], "content_gaps": string[] }',
    },
    {
      role: 'Keyword Expander & Intent Classifier',
      capabilities: ['keyword_expansion', 'intent_classification'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: `Expand each seed keyword into related long-tail variants. For each keyword, classify search intent (informational, navigational, commercial, transactional) and estimate difficulty (low/medium/high) based on SERP competition.
Produce at least 30 unique keywords, prioritising buyer-intent and low-difficulty opportunities.`,
      handoffProtocol: 'Output: { "keywords": [{ "term": string, "intent": string, "difficulty": string, "seed_parent": string, "content_type_suggestion": string }] }',
    },
    {
      role: 'Topic Cluster Planner',
      capabilities: ['content_strategy', 'cluster_planning'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: `Group keywords into topic clusters with one pillar page and 4–6 supporting cluster articles per pillar.
For each pillar, provide: title, target keyword, word count recommendation, internal linking strategy.
For each cluster article: title, target keyword, word count, angle/hook, and which pillar it supports.
Output a 3-month content calendar with monthly publishing cadence.`,
      handoffProtocol: 'Output: { "pillars": [{ "title": string, "keyword": string, "word_count": number, "clusters": [{ "title": string, "keyword": string, "word_count": number, "angle": string, "month": number }] }] }',
    },
    {
      role: 'Article Outline Writer',
      capabilities: ['content_outlining', 'seo_writing'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: `Write full SEO-optimised article outlines for the top 3 pillar pages.
Each outline: H1 (with primary keyword), meta title (≤60 chars), meta description (≤155 chars), intro hook (2 sentences), H2 sections with bullet points for key coverage, FAQ section (5 questions targeting PAA), and CTA.
Use natural keyword placement — no keyword stuffing. Write for humans first, search engines second.`,
      handoffProtocol: 'Output: { "outlines": [{ "pillar_title": string, "meta_title": string, "meta_description": string, "h1": string, "sections": [{ "h2": string, "key_points": string[] }], "faq": [{ "q": string, "a_hint": string }], "cta": string }] }',
    },
    {
      role: 'Google Sheets Exporter',
      capabilities: ['create_spreadsheet', 'data_organization'],
      requiresExternalData: true,
      tools: [{ name: 'Google Sheets API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }],
      systemPrompt: 'Create a Google Sheet with 3 tabs: (1) "Keyword Master List" — all keywords with intent, difficulty, and cluster assignment; (2) "Content Calendar" — 3-month publishing schedule with pillar/cluster label; (3) "Article Outlines" — each outline as structured rows.',
      handoffProtocol: 'Output: { "sheet_url": string, "keyword_count": number, "pillar_count": number, "cluster_count": number }',
    }
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 600 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'oauth_token', service: 'google', scope: 'sheets', confidentialityLevel: 'internal' }
  ],
  validationChecklist: [
    'At least 30 unique keywords expanded from seeds',
    'Every keyword has intent and difficulty classified',
    'Topic clusters are logically grouped (no isolated keywords)',
    '3-month calendar is realistic (4–6 articles/month max)',
    'Article outlines have proper meta tags and FAQ sections',
    'Google Sheet has all 3 tabs populated correctly'
  ],
  discoveryQuestions: [
    'What is your website/business niche or industry?',
    'Who is your target audience — beginners or experts?',
    'Do you have any competitor websites you want to outrank?',
    'What is your publishing capacity? (articles per month)',
    'Are you targeting a specific country or global English?'
  ],
  referenceHints: `For SEO keyword missions:
- ALWAYS start with competitor SERP analysis before keyword expansion
- Keyword list should have a mix of difficulty: 40% low, 40% medium, 20% high (stretch goals)
- Intent classification drives content format: informational→how-to/guide, commercial→comparison/review, transactional→landing page
- Topic clusters must link to their pillar internally — mention this in the outline
- FAQ sections should target "People Also Ask" boxes (use real PAA questions from Tavily SERPs)
- Google Sheet tab 1 is the master list; tab 2 is calendar with due dates; tab 3 stores raw outlines
- If user has a specific domain, search it first to avoid duplicating existing content`
};

// ── Template 7: Lead Enrichment Pipeline ──
const LEAD_ENRICHMENT: TemplateConfig = {
  id: 'lead_enrichment',
  title: 'Lead Enrichment & Outreach Prep',
  description: 'Take a list of company names or LinkedIn URLs, enrich each lead with company info and decision-maker contacts, score by fit, and output an enriched spreadsheet ready for outreach.',
  keywords: ['lead', 'leads', 'enrichment', 'enrich', 'prospect', 'prospecting', 'outreach', 'b2b', 'contact', 'decision maker', 'icp', 'ideal customer', 'crm', 'sales pipeline', 'cold email list', 'company research', 'linkedin', 'firmographic', 'lead list', 'lead generation', 'qualify'],
  category: 'sales',
  agents: [
    {
      role: 'Lead Parser & Validator',
      capabilities: ['data_parsing', 'list_processing'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: 'Parse the provided lead list (company names, domains, or LinkedIn URLs). Deduplicate, normalise company names, and extract any known fields (industry, size hint, geography). Flag entries that appear incomplete or ambiguous.',
      handoffProtocol: 'Output: { "leads": [{ "id": number, "company": string, "domain_hint": string, "linkedin_url": string|null, "flag": string|null }], "total": number, "flagged": number }',
    },
    {
      role: 'Company Research Agent',
      capabilities: ['web_search', 'firmographic_research'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: `For each company, search the web to find: official website, industry/vertical, employee headcount (or band), funding stage (bootstrapped/seed/series/public), HQ location, key products/services, and recent news (last 6 months).
Process ALL leads — do not skip any. Mark data confidence as high/medium/low per field.`,
      handoffProtocol: 'Output: { "enriched": [{ "id": number, "company": string, "website": string, "industry": string, "headcount_band": string, "funding_stage": string, "hq": string, "products": string, "recent_news": string, "confidence": string }] }',
    },
    {
      role: 'Decision Maker Finder',
      capabilities: ['web_search', 'contact_research'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: `For each company, identify 1–2 decision makers matching the ideal customer profile role (e.g., CEO, CTO, VP Sales, Head of Marketing — adapt to user's ICP).
Search for their name, LinkedIn URL, and role. Do NOT fabricate email addresses — only include verified/guessed email formats if publicly available.`,
      handoffProtocol: 'Output: { "contacts": [{ "company_id": number, "name": string, "role": string, "linkedin": string|null, "email_guess": string|null, "confidence": string }] }',
    },
    {
      role: 'ICP Scorer & Prioritiser',
      capabilities: ['lead_scoring', 'prioritization'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: `Score each lead 1–10 against the user's Ideal Customer Profile (ICP).
Scoring criteria (adapt weights based on what the user cares about): industry fit (30%), company size fit (25%), funding/budget signal (20%), geography fit (15%), decision maker identified (10%).
Classify each lead: Tier 1 (score ≥8, hot), Tier 2 (5–7, warm), Tier 3 (<5, cold/remove).
Write a 1-sentence personalisation hook per Tier 1 lead (reference recent news or a specific detail).`,
      handoffProtocol: 'Output: { "scored": [{ "company_id": number, "icp_score": number, "tier": string, "score_breakdown": object, "personalisation_hook": string|null }] }',
    },
    {
      role: 'Enriched Sheet Builder',
      capabilities: ['create_spreadsheet', 'crm_export'],
      requiresExternalData: true,
      tools: [{ name: 'Google Sheets API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }],
      systemPrompt: `Create a Google Sheet named "[Company] Lead Enrichment — [Date]" with 2 tabs:
Tab 1 "Enriched Leads": one row per company — Company, Website, Industry, Size, Funding, HQ, Recent News, ICP Score, Tier, Decision Maker Name, Role, LinkedIn, Email Guess, Personalisation Hook.
Tab 2 "Tier 1 Outreach": only Tier 1 leads with the personalisation hook and a blank "Outreach Status" column.
Apply conditional formatting: green for Tier 1, yellow for Tier 2, grey for Tier 3.`,
      handoffProtocol: 'Output: { "sheet_url": string, "total_leads": number, "tier_1": number, "tier_2": number, "tier_3": number }',
    }
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 600 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'oauth_token', service: 'google', scope: 'sheets', confidentialityLevel: 'internal' }
  ],
  validationChecklist: [
    'Every lead from the input list appears in the output sheet',
    'Company data has confidence ratings — no hallucinated info',
    'Decision makers are real (searched, not fabricated)',
    'ICP scoring reflects the user\'s stated criteria, not generic criteria',
    'Tier 1 personalisation hooks reference specific, verifiable details',
    'Google Sheet has both tabs with correct conditional formatting'
  ],
  discoveryQuestions: [
    'Paste your lead list here — company names, domains, or LinkedIn URLs, one per line.',
    'What is your Ideal Customer Profile? (industry, company size, geography, funding stage)',
    'What role/title should the decision maker have? (CEO, Head of Marketing, CTO, etc.)',
    'What is your product or service? (helps the scorer assess fit accurately)',
    'Should Tier 3 (low-fit) leads be excluded from the sheet or kept with a "cold" flag?'
  ],
  referenceHints: `For lead enrichment missions:
- Parser runs first and sets IDs — all later agents reference the same company IDs
- Company research and decision maker finding are the most time-consuming — process in batches if list > 20
- NEVER fabricate email addresses. Use publicly available patterns (firstname@domain.com) only if confident
- ICP scoring weights MUST be adapted to the user's stated criteria — don't use generic weights blindly
- Personalisation hooks must be grounded in real, verifiable data (funding round, product launch, news)
- Two-tab sheet structure is mandatory: full enrichment + Tier 1 outreach-ready tab
- If the user provides a CRM (HubSpot, Salesforce), offer to export as CSV compatible with that CRM`
};

// ── All Templates ──
const ALL_TEMPLATES: TemplateConfig[] = [
  RESEARCH_REPORT_EMAIL,
  CONTENT_CREATION,
  DATA_COLLECTION,
  HR_RECRUITMENT,
  COPYWRITER_AD_EMAIL,
  SEO_KEYWORD_CALENDAR,
  LEAD_ENRICHMENT,
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
