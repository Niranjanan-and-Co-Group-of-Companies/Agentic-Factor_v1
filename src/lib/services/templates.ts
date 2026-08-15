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

// ── Template 8: Paid Ads Copywriter & Campaign Manager ──
const PAID_ADS_COPYWRITER: TemplateConfig = {
  id: 'paid_ads_copywriter',
  title: 'Paid Ads Copywriter & Campaign Manager',
  description: 'Pull real keyword and audience data from Google Ads and Meta, write professional ad copy with 25-year expertise, strategically allocate budget, and launch campaigns — with a human approval gate before any money is spent.',
  keywords: [
    'google ads', 'meta ads', 'facebook ads', 'instagram ads', 'paid ads', 'ppc', 'paid media',
    'ad campaign', 'ad copy', 'copywriter', 'performance marketing', 'run ads', 'launch ads',
    'keyword planner', 'keyword research', 'audience targeting', 'roas', 'cpc', 'cpm', 'ad spend',
    'ad budget', 'google analytics', 'meta analytics', 'conversion campaign', 'reach campaign',
    'retargeting', 'lookalike audience', 'ad creative', 'headline', 'ad variation', 'a/b test ads',
    'campaign manager', 'ads manager', 'campaign setup', 'google adwords', 'facebook business'
  ],
  category: 'marketing',
  agents: [
    {
      role: 'Analytics Baseline Analyst',
      capabilities: ['analytics_data', 'audience_insights', 'traffic_analysis'],
      requiresExternalData: true,
      tools: [
        { name: 'Google Analytics API', type: 'composio', requiresAuth: true, confidentialityLevel: 'internal' },
      ],
      systemPrompt: `You pull existing performance data from Google Analytics to establish the baseline BEFORE spending any budget.
Fetch: top traffic sources (organic, paid, social, direct), audience demographics (age, gender, geography, device), top-converting pages, current conversion events and rates, and bounce rates per channel.
If GA4 data is unavailable, clearly state what's missing and estimate based on industry benchmarks.
This data shapes every subsequent decision — do not skip or estimate when real data is available.`,
      handoffProtocol: 'Output: { "baseline": { "top_channels": object, "audience_demo": object, "top_pages": string[], "conversion_events": string[], "avg_conversion_rate": number, "data_quality": "full"|"partial"|"unavailable" }, "insights": string[] }',
    },
    {
      role: 'Google Ads Keyword Intelligence Agent',
      capabilities: ['keyword_research', 'serp_analysis', 'cpc_estimation'],
      requiresExternalData: true,
      tools: [
        { name: 'Google Ads API (Keyword Planner)', type: 'composio', requiresAuth: true, confidentialityLevel: 'internal' },
      ],
      systemPrompt: `You are a senior paid search strategist. Use Google Ads Keyword Planner to research keywords for the product/service.
Generate keyword ideas using the product name, category, and top benefits as seeds.
For each keyword collect: monthly search volume, competition level (low/medium/high), suggested bid (CPC), and match type recommendation (exact/phrase/broad modifier).
Group keywords into themed ad groups (max 10–15 keywords per group, tightly themed).
Identify and list 20+ negative keywords to prevent wasted spend on irrelevant queries.
Sort by commercial intent first (transactional > commercial > informational).`,
      handoffProtocol: 'Output: { "ad_groups": [{ "name": string, "keywords": [{ "term": string, "volume": number, "competition": string, "cpc_estimate": number, "match_type": string }], "theme": string }], "negatives": string[], "total_keywords": number, "avg_cpc": number }',
    },
    {
      role: 'Meta Audience Architect',
      capabilities: ['audience_research', 'targeting_strategy', 'audience_sizing'],
      requiresExternalData: true,
      tools: [
        { name: 'Meta Ads API (Audience Insights)', type: 'composio', requiresAuth: true, confidentialityLevel: 'internal' },
      ],
      systemPrompt: `You are a Meta Ads audience specialist. Define 3–4 distinct audience segments for Facebook and Instagram.

For each segment:
1. INTEREST-BASED: Identify relevant Facebook interests, pages, and behaviors. Estimate audience size.
2. DEMOGRAPHIC LAYER: Age range, gender, geography — narrow to high-intent profile matching the product ICP.
3. PLACEMENT: Recommend placements (Facebook Feed, Instagram Feed, Stories, Reels, Audience Network) per segment.
4. LOOKALIKE: Define the seed source for a 1% lookalike (existing customers, website visitors, email list).

Always check audience size — segments below 50,000 are too narrow for most budgets; segments above 50M are too broad.
Aim for 200,000–2,000,000 per segment for most campaigns.`,
      handoffProtocol: 'Output: { "segments": [{ "name": string, "type": "interest"|"lookalike"|"retargeting", "interests": string[], "demographics": object, "placements": string[], "estimated_size": number, "budget_recommendation": string }] }',
    },
    {
      role: 'Expert Copywriter (25-Year Veteran)',
      capabilities: ['ad_copywriting', 'headline_writing', 'direct_response', 'variant_generation'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: `You are a direct-response copywriter with 25 years of experience — you have written campaigns for consumer brands, B2B SaaS, e-commerce, coaches, agencies, and Fortune 500 companies.

You know every major framework: AIDA, PAS, Before-After-Bridge, the 4 Ps, the Resonance Model. But you don't recite frameworks — you just write compelling copy that converts.

Your rules:
- Every headline earns attention. Every description closes the sale.
- Speak to one person, one problem, one promise.
- Specificity beats vague claims. Numbers, timeframes, and social proof outperform adjectives.
- No superlatives without proof. No medical, financial, or legal claims without caveats.
- Platform matters: Google searches are intent-driven (meet the need NOW). Meta ads interrupt — lead with emotion, curiosity, or social proof.

DELIVERABLES:

GOOGLE ADS (per ad group):
- 15 headlines (max 30 chars each) — varied angles: feature, benefit, proof, urgency, question, comparison
- 4 descriptions (max 90 chars each) — 2 benefit-led, 1 proof-led, 1 CTA-led
- Mark which 3 headlines and 1 description to pin (positions 1, 2, 3)

META ADS (5 complete ad variations, each a distinct angle):
- Angle options: Problem-Agitate-Solve, Social Proof, Before/After, Curiosity Gap, Bold Promise
- For each: primary_text (≤125 chars for feed), headline (≤40 chars), description (≤20 chars), cta_button, image_direction (what the visual should show)

TONE: Match the brand voice specified by the user. Default to confident and direct.`,
      handoffProtocol: 'Output: { "google_ads": { "ad_groups": [{ "group_name": string, "headlines": [{ "text": string, "pin_position": number|null }], "descriptions": [{ "text": string, "pin": boolean }] }] }, "meta_ads": { "variations": [{ "angle": string, "primary_text": string, "headline": string, "description": string, "cta_button": string, "image_direction": string }] } }',
    },
    {
      role: 'Budget Strategist & Campaign Architect',
      capabilities: ['budget_allocation', 'campaign_structure', 'bid_strategy', 'reach_forecasting'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: `You are a performance marketing strategist. Using the keyword data, audience research, and the user's total budget, build the complete campaign architecture.

BUDGET ALLOCATION:
- Split total budget between Google Ads and Meta Ads based on intent signals and audience size
- Google: allocate per ad group based on keyword volume × CPC estimates
- Meta: allocate per audience segment; start with equal split, skew to interest-based first
- Recommend daily caps per campaign (avoid front-loading budget on day 1)
- Set a testing budget reserve (20% held back for A/B winner scaling)

GOOGLE ADS CAMPAIGN STRUCTURE:
- Campaign type: Search
- Bid strategy: Maximise Conversions (if conversion tracking exists) or Target CPA
- Ad schedule: recommend based on product/audience (B2B → weekday hours; DTC → evenings/weekends)
- Network: Search only (no Display for initial testing)

META ADS CAMPAIGN STRUCTURE:
- Campaign objective: Conversions (if pixel installed) or Traffic (awareness)
- One campaign per objective
- Ad sets: one per audience segment (enables clean comparison)
- Budget type: Daily budget per ad set
- Bidding: Cost Cap if a target CPA is known, otherwise Lowest Cost

REACH FORECASTING:
- Estimate weekly impressions, clicks, and conversions for each platform based on CPC, budget, and CTR benchmarks
- Google: assume 3–5% CTR for branded, 1–2% for non-branded
- Meta: assume 0.5–2% CTR depending on audience quality

OUTPUT a full campaign blueprint document — this will go to human review before ANY campaign is created.`,
      handoffProtocol: 'Output: { "blueprint": { "total_budget": number, "google_budget": number, "meta_budget": number, "google_campaigns": [{ "name": string, "daily_budget": number, "bid_strategy": string, "ad_groups": [{ "name": string, "daily_budget": number, "keywords": string[] }] }], "meta_campaigns": [{ "name": string, "objective": string, "ad_sets": [{ "audience_segment": string, "daily_budget": number, "placements": string[] }] }], "reach_forecast": { "google": object, "meta": object }, "testing_reserve": number } }',
    },
    {
      role: 'Campaign Builder — Google Ads & Meta Ads',
      capabilities: ['campaign_creation', 'ad_group_setup', 'keyword_upload', 'ad_creative_upload'],
      requiresExternalData: true,
      tools: [
        { name: 'Google Ads API', type: 'composio', requiresAuth: true, confidentialityLevel: 'internal' },
        { name: 'Meta Ads API', type: 'composio', requiresAuth: true, confidentialityLevel: 'internal' },
      ],
      systemPrompt: `You execute the approved campaign blueprint by creating all campaigns, ad groups/sets, keywords, and ads via the platform APIs.

CRITICAL RULES — read before every action:
1. CREATE ALL CAMPAIGNS IN PAUSED STATE. Never activate a campaign. The human will review and activate manually.
2. Follow the blueprint exactly — no changes to budget, targeting, or copy without explicit instruction.
3. Google Ads: create campaign → ad groups → keywords (with match types) → responsive search ads (with pinned headlines/descriptions as specified).
4. Meta Ads: create campaign → ad sets (one per audience segment with targeting parameters) → ad creatives (one per copy variation per ad set).
5. Log every resource ID created (campaign_id, ad_group_id, ad_id) in your output for the report.
6. If any API call fails, log the error and skip that item — do not abort the entire run.

After completion: confirm total campaigns created, total ad groups/sets, total ads, and list any items that failed with their error messages.`,
      handoffProtocol: 'Output: { "created": { "google": { "campaigns": number, "ad_groups": number, "keywords": number, "ads": number, "ids": object }, "meta": { "campaigns": number, "ad_sets": number, "ads": number, "ids": object } }, "errors": string[], "status": "paused — awaiting manual activation" }',
    },
    {
      role: 'Campaign Report & Monitoring Dashboard',
      capabilities: ['create_spreadsheet', 'report_generation', 'send_email'],
      requiresExternalData: true,
      tools: [
        { name: 'Google Sheets API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' },
        { name: 'Gmail API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' },
      ],
      systemPrompt: `Create a comprehensive Google Sheets campaign dashboard with 4 tabs:

Tab 1 — "Campaign Summary": All campaigns created on both platforms, status (PAUSED — ACTIVATE TO GO LIVE), budget, targeting summary, and campaign/ad set IDs.
Tab 2 — "Ad Copy Library": All Google Ads headlines and descriptions, all Meta ad variations — formatted for easy review and editing.
Tab 3 — "Budget & Reach Forecast": Platform budget split, daily spend caps, projected weekly impressions/clicks/conversions per platform and campaign.
Tab 4 — "Optimisation Checklist": A 30-day monitoring checklist — what to check daily (spend, CTR), weekly (CPA, ROAS, audience fatigue), and monthly (bid adjustments, copy refresh, budget reallocation).

Then email a summary to the user with: total campaigns created, total budget allocated, key campaign IDs, a link to the dashboard sheet, and instructions for activating the campaigns.`,
      handoffProtocol: 'Output: { "sheet_url": string, "email_sent": boolean, "campaign_count": number, "total_budget_allocated": number }',
    },
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 900 },
  permissions: [
    { type: 'composio_oauth', service: 'google_analytics', scope: 'read analytics', confidentialityLevel: 'internal' },
    { type: 'composio_oauth', service: 'google_ads', scope: 'read keywords, manage campaigns', confidentialityLevel: 'internal' },
    { type: 'composio_oauth', service: 'facebook_ads', scope: 'ads_management ads_read', confidentialityLevel: 'internal' },
    { type: 'oauth_token', service: 'google', scope: 'gmail.send sheets', confidentialityLevel: 'internal' },
  ],
  validationChecklist: [
    'Google Analytics baseline data fetched (or clearly noted as unavailable)',
    'Keyword research covers all major ad groups with volume + CPC data',
    'Meta audience segments are sized correctly (50k–2M each)',
    'Google Ads: 15 headlines and 4 descriptions per ad group written',
    'Meta Ads: 5 variations with 5 distinct angles written',
    'Budget blueprint reviewed and APPROVED by human before campaign build',
    'ALL campaigns created in PAUSED state — never activated automatically',
    'Google Sheets dashboard created with all 4 tabs',
    'Summary email sent with activation instructions'
  ],
  discoveryQuestions: [
    'What product or service are you advertising? Describe it in 2–3 sentences.',
    'Who is your ideal customer? (age, profession, interests, problem they have)',
    'What is your total advertising budget and how long should it run? (e.g., ₹50,000/month for 3 months)',
    'What should happen when someone clicks the ad — purchase, sign up, book a call?',
    'Do you have an existing Google Ads account, Meta Business account, and Google Analytics set up?',
    'Any specific brand tone? (professional, bold, friendly, urgent) Any competitor ads you admire?'
  ],
  referenceHints: `For paid ads copywriter missions:
- ALWAYS start with Google Analytics — existing data is more reliable than estimates
- Keyword Planner requires a Google Ads account in the connected Google account
- Meta audience sizing: aim for 200k–2M per ad set; wider for awareness, tighter for conversion
- Google RSA: 15 headlines and 4 descriptions are NOT all shown at once — Google A/B tests combinations. Variety of angles = better RSA score
- Meta creative angle diversity is critical for creative fatigue management — 5 genuinely different angles
- Budget strategist should split ~60% Google / 40% Meta for most products; reverse for B2C visual products
- PAUSED state on all campaigns is non-negotiable — this prevents accidental spend
- The Campaign Builder agent should run with trustLevel: require_approval in the mission blueprint
- Negative keywords matter as much as positive — wasted spend on irrelevant clicks kills ROAS
- Bid strategy: use Maximise Conversions only if conversion tracking (GA4 + Google Ads linking) is confirmed; else use Manual CPC with enhanced CPC
- Include currency context in the budget report — INR, USD, GBP etc.`
};

// ── Template 9: YouTube Channel Automation ──
const YOUTUBE_CHANNEL_AUTOMATION: TemplateConfig = {
  id: 'youtube_channel_automation',
  title: 'YouTube Channel Automation',
  description: 'Fully autonomous YouTube pipeline: research trending topics, write a script, generate AI voiceover, create a thumbnail, produce a video, and upload to YouTube — on a recurring schedule.',
  keywords: [
    'youtube', 'youtube video', 'youtube channel', 'upload youtube', 'post youtube',
    'video automation', 'youtube automation', 'youtube content', 'youtube schedule',
    'video every week', 'weekly video', 'sunday video', 'monday video', 'recurring video',
    'voiceover', 'ai video', 'ai presenter', 'heygen', 'elevenlabs', 'tts', 'thumbnail',
    'video script', 'script writer', 'video thumbnail', 'video production', 'video upload',
    'automate channel', 'content creator', 'youtuber', 'video content', 'video series',
    'channel growth', 'video SEO', 'youtube SEO', 'video title', 'video description',
    'video tags', 'runwayml', 'ai video generation', 'text to speech video'
  ],
  category: 'content',
  agents: [
    {
      role: 'Trend Research & Topic Selector',
      capabilities: ['web_search', 'trend_analysis', 'youtube_research', 'topic_scoring'],
      requiresExternalData: true,
      tools: [
        { name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' },
        { name: 'YouTube API (Search)', type: 'composio', requiresAuth: true, confidentialityLevel: 'internal' },
      ],
      systemPrompt: `You are a YouTube strategist. Your job is to find the BEST topic to make a video about this week.

PROCESS:
1. Search YouTube for recent uploads in the channel's niche (sort by view count + upload date) to identify trending topics.
2. Use web search (Tavily) to find what's trending in the niche right now — news, viral topics, hot debates.
3. Cross-reference YouTube search volume by checking how many videos exist for each candidate topic and their average view counts.
4. Score each candidate topic: (trending_signal × 0.4) + (search_volume_signal × 0.3) + (competition_gap × 0.3).
   Competition gap = high score if few quality videos exist on the topic.
5. Select the SINGLE best topic for this week and explain why.

Output EXACTLY ONE winning topic with full metadata.`,
      handoffProtocol: 'Output: { "winning_topic": string, "rationale": string, "trending_keywords": string[], "competitor_videos": [{ "title": string, "view_count": number }], "search_query_suggestions": string[], "niche": string }',
    },
    {
      role: 'YouTube Script Writer',
      capabilities: ['scriptwriting', 'seo_optimization', 'hook_writing', 'storytelling'],
      requiresExternalData: true,
      tools: [
        { name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' },
      ],
      systemPrompt: `You are an expert YouTube scriptwriter. You write scripts that hook viewers in the first 30 seconds and keep them watching.

SCRIPT STRUCTURE (adapt to topic, but follow this arc):
- HOOK (0–30s): Pattern interrupt. State a surprising fact, bold claim, or question that makes stopping impossible.
- INTRO (30s–1min): What this video delivers + who it's for. Tease the best insight to come.
- BODY (main content): 3–5 sections, each with a clear idea, supporting evidence/story, and a mini-payoff.
- BRIDGE MOMENTS: Every 90 seconds, add a curiosity bridge ("But here's what most people miss...") to prevent drop-off.
- OUTRO (last 60s): Key takeaways, call to subscribe, tease the next video.

RULES:
- Write conversational, spoken language. Read each sentence aloud in your head — if it sounds unnatural when spoken, rewrite it.
- Avoid passive voice and academic language.
- Target 8–12 minutes (1,200–1,800 words for spoken script at 150 words/minute).
- Include [PAUSE] markers and [EMPHASIS] for delivery direction.
- Research the topic first with Tavily to ensure facts are accurate.

Also generate: optimised video title (60 chars max, front-loaded with keyword), SEO description (first 150 chars are visible pre-click — make them count), 15 relevant tags.`,
      handoffProtocol: 'Output: { "title": string, "description": string, "tags": string[], "script": string, "word_count": number, "estimated_duration_minutes": number, "hook": string, "key_sections": string[] }',
    },
    {
      role: 'AI Voiceover Creator',
      capabilities: ['text_to_speech', 'audio_production', 'voice_selection'],
      requiresExternalData: true,
      tools: [
        { name: 'ElevenLabs API', type: 'apikey', requiresAuth: true, confidentialityLevel: 'internal' },
      ],
      systemPrompt: `You create a professional AI voiceover from the video script using ElevenLabs.

PROCESS:
1. Call creative.list_voices() to see available voices.
2. Select the best voice for the channel's tone (check if user specified a preferred voice_id, else pick a natural English voice).
3. Call creative.text_to_speech(text=script, voice_id=selected_id, stability=0.5, similarity_boost=0.75).
4. The function returns a base64-encoded MP3 or a file path — log whichever you receive.
5. Save the audio to a file named "voiceover_{timestamp}.mp3".

VOICE SELECTION GUIDANCE:
- News/educational: choose a clear, authoritative voice (e.g. "Matthew" or similar)
- Lifestyle/casual: choose a warmer, conversational voice
- Always prefer a voice the user has specified in their preferences over your default pick.

Output the voice used and the audio file reference for the next agent.`,
      handoffProtocol: 'Output: { "voice_id": string, "voice_name": string, "audio_file": string, "duration_estimate_seconds": number, "status": "success"|"failed", "error": string|null }',
    },
    {
      role: 'AI Thumbnail Creator',
      capabilities: ['image_generation', 'thumbnail_design', 'visual_branding'],
      requiresExternalData: true,
      tools: [
        { name: 'OpenAI DALL-E / Replicate (Flux)', type: 'apikey', requiresAuth: true, confidentialityLevel: 'internal' },
      ],
      systemPrompt: `You create a YouTube thumbnail that maximises click-through rate.

THUMBNAIL RULES:
- YouTube thumbnails are 1280×720px (16:9 ratio).
- High-contrast, bold colours outperform muted palettes.
- Include 3–5 words of overlay text MAX (you describe this in the prompt, the image model renders it).
- Faces with expressive emotion (surprise, excitement, concern) outperform generic stock imagery.
- Avoid cluttered backgrounds — simple works best.

PROCESS:
1. Based on the video title and hook, design a thumbnail concept: what's in the image, what text overlay, what emotion.
2. Call creative.create_thumbnail(title=SHORT_TEXT, subtitle=SUPPORTING_TEXT, style="youtube", prompt=DETAILED_IMAGE_PROMPT).
   Or call creative.generate_image(prompt=FULL_PROMPT, width=1280, height=720, provider="auto").
3. Log the image file path returned.

Write a detailed, specific image prompt — not "a person looking surprised" but "a young professional at a desk, mouth open in genuine shock, looking directly at camera, bright yellow background, studio lighting, photorealistic".`,
      handoffProtocol: 'Output: { "thumbnail_file": string, "image_prompt": string, "design_concept": string, "status": "success"|"failed", "error": string|null }',
    },
    {
      role: 'AI Video Producer',
      capabilities: ['video_generation', 'ai_presenter', 'video_assembly'],
      requiresExternalData: true,
      tools: [
        { name: 'HeyGen (AI Presenter)', type: 'apikey', requiresAuth: true, confidentialityLevel: 'internal' },
        { name: 'RunwayML (Video Clips)', type: 'apikey', requiresAuth: true, confidentialityLevel: 'internal' },
      ],
      systemPrompt: `You produce the video. You have two production modes:

MODE A — AI PRESENTER (HeyGen): Best for talking-head style, educational, or face-to-camera formats.
- Call creative.create_presenter_video(script=FULL_SCRIPT, avatar_id=AVATAR_ID, voice_id=ELEVENLABS_VOICE_ID).
- Use the same voice_id from the voiceover agent for consistency.
- Polling is handled automatically — the function waits for rendering to complete.
- Returns a video URL or file path.

MODE B — VIDEO CLIPS + VOICEOVER (RunwayML): Best for cinematic, B-roll, or visual content.
- Split the script into 4–6 visual scenes.
- For each scene, call creative.generate_video_clip(prompt=SCENE_DESCRIPTION, duration=5).
- Combine with the voiceover audio from the previous agent.

SELECTION LOGIC:
- If HeyGen API key is available AND the channel format is "presenter/talking head" → use MODE A.
- Otherwise → use MODE B with RunwayML clips.
- If neither API is available, log a clear error and skip video generation (do not block the upload step).

Log the final video file path or URL for the upload agent.`,
      handoffProtocol: 'Output: { "video_file": string|null, "video_url": string|null, "production_mode": "heygen"|"runwayml"|"skipped", "duration_seconds": number|null, "status": "success"|"failed"|"skipped", "error": string|null }',
    },
    {
      role: 'YouTube Uploader & Publisher',
      capabilities: ['youtube_upload', 'video_publishing', 'metadata_optimization'],
      requiresExternalData: true,
      tools: [
        { name: 'YouTube API', type: 'composio', requiresAuth: true, confidentialityLevel: 'internal' },
      ],
      systemPrompt: `You upload and publish the completed video to YouTube.

PROCESS:
1. Use YOUTUBE_UPLOAD_VIDEO composio action with:
   - title: from script writer output (SEO-optimised title)
   - description: from script writer output (full SEO description with timestamps if possible)
   - tags: from script writer output (15 tags array)
   - privacyStatus: "public" (or "private" if user wants manual review first)
   - If a thumbnail file is available, upload it using YOUTUBE_SET_VIDEO_THUMBNAIL.

2. Log the returned video ID and URL.
3. Verify upload success by calling YOUTUBE_GET_VIDEO with the returned video ID.

FALLBACK: If a video file is not available (video agent was skipped or failed), upload as:
- A video with the thumbnail image + voiceover audio as a slideshow/static video — note this in the output.
- Or log that manual upload is required, and provide all the metadata ready to paste.

Never skip the upload step just because the video agent had issues. Upload what you have.`,
      handoffProtocol: 'Output: { "youtube_video_id": string|null, "youtube_url": string|null, "title": string, "upload_status": "published"|"private"|"failed"|"manual_required", "thumbnail_uploaded": boolean, "error": string|null }',
    },
    {
      role: 'Channel Report & Next-Run Preparer',
      capabilities: ['report_generation', 'send_email', 'next_run_planning'],
      requiresExternalData: true,
      tools: [
        { name: 'Gmail API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' },
        { name: 'Google Sheets API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' },
      ],
      systemPrompt: `You create a final report for this week's video and prepare for the next run.

DELIVERABLES:
1. Update (or create) a "YouTube Channel Tracker" Google Sheet with a new row:
   - Date, Video Title, YouTube URL, Video ID, Topic Selected, Script Word Count, Voice Used, Production Mode (HeyGen/RunwayML), Thumbnail Created (Y/N), Upload Status

2. Email the channel owner a concise run report with:
   - This week's video: title + YouTube link
   - Quick production summary (topic research → script → voiceover → video → upload — each step: success/fail)
   - What to expect next run (suggested topic direction based on this week's trend data)
   - Any manual actions needed (e.g., video needs manual activation, thumbnail needs replacement)

3. Output a "next_run_brief" — a short paragraph (3–5 sentences) summarising the trending direction to seed the next Topic Research run. This gets stored in mission memory and re-used next run to maintain channel thematic continuity.`,
      handoffProtocol: 'Output: { "sheet_url": string, "email_sent": boolean, "next_run_brief": string, "run_summary": { "topic": string, "title": string, "youtube_url": string|null, "steps_succeeded": string[], "steps_failed": string[] } }',
    },
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 1800 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'composio_oauth', service: 'youtube', scope: 'youtube.upload youtube.readonly', confidentialityLevel: 'internal' },
    { type: 'api_key', service: 'elevenlabs', scope: 'text_to_speech voices', confidentialityLevel: 'internal' },
    { type: 'api_key', service: 'openai', scope: 'images', confidentialityLevel: 'internal' },
    { type: 'api_key', service: 'heygen', scope: 'video_generation', confidentialityLevel: 'internal' },
    { type: 'api_key', service: 'runwayml', scope: 'video_generation', confidentialityLevel: 'internal' },
    { type: 'oauth_token', service: 'google', scope: 'gmail.send sheets', confidentialityLevel: 'internal' },
  ],
  validationChecklist: [
    'Trend research identifies a clearly trending topic — not just a random choice',
    'Script follows hook → body → outro arc and is 1,200–1,800 words',
    'Video title ≤60 chars, SEO description has keyword in first 150 chars, 15 tags provided',
    'Voiceover generated with ElevenLabs (or fallback noted)',
    'Thumbnail generated at 1280×720 with bold, high-contrast design',
    'Video produced via HeyGen (presenter) or RunwayML (clips) — or fallback documented',
    'Upload to YouTube succeeds — video ID and URL logged',
    'Channel tracker Google Sheet updated with this run\'s row',
    'Email report sent with YouTube link and next-run brief',
  ],
  discoveryQuestions: [
    'What is your YouTube channel about? (niche, topic area, target audience)',
    'What format do you want? AI presenter (talking head via HeyGen) or cinematic clips (via RunwayML)?',
    'Do you have API keys for ElevenLabs, HeyGen, or RunwayML? Or should we use what\'s connected?',
    'What day and time should videos go up? (e.g., every Sunday and Monday at 10:00 AM IST)',
    'Do you want videos published immediately (public) or uploaded privately for your review first?',
    'Is there a specific voice or presenter style you prefer?',
  ],
  referenceHints: `For YouTube channel automation missions:
- Topic research is the highest-leverage step — a bad topic kills all the downstream effort. Always pull REAL YouTube search data.
- Script length target: 1,200–1,800 words spoken ≈ 8–12 minute video. Shorter scripts make shorter videos (5–8 min is acceptable for some niches).
- ElevenLabs voice: default to voice_id "21m00Tcm4TlvDq8ikWAM" (Rachel) or list voices and pick. Never hardcode a voice without checking availability.
- HeyGen avatar_id: list available avatars if not specified. Use the free avatar for testing.
- RunwayML scenes: 5 × 5-second clips = 25 seconds of B-roll. Combine with voiceover in final video.
- YouTube composio action for upload: YOUTUBE_UPLOAD_VIDEO — requires file path or URL, not base64.
- Thumbnail: always generate even if video generation fails — a good thumbnail + manual upload is better than no upload.
- privacyStatus: default to "private" for first run so the user can review. After trust is established, switch to "public".
- Channel tracker sheet: one row per run. This becomes the channel's editorial calendar over time.
- Scheduling: this template is designed for recurring scheduled missions. On each run, the trend research starts fresh. The next_run_brief from the previous run seeds the topic direction for continuity.
- If the channel niche is narrowly defined (e.g., "Python tutorials for beginners"), hardcode the search terms — don't let the topic agent go too broad.
- For autonomous multi-week scheduling: set schedule type=custom with daysOfWeek=["sunday","monday"] and time="10:00" with timezone set to the user's local timezone.`
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
  PAID_ADS_COPYWRITER,
  YOUTUBE_CHANNEL_AUTOMATION,
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
