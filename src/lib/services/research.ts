import { createServiceClient } from '../supabase/server';

// ============================================================
// Research & Fact-Check Module
//
// Performs web research for agents tagged with requiresExternalData.
// Returns a ResearchReport with cited sources and confidence scores.
// If confidence < threshold, flags the action for HITL review.
// ============================================================

export interface ResearchSource {
  url: string;
  title: string;
  snippet: string;
  relevance: number; // 0.0 – 1.0
}

export interface ResearchReport {
  id: string;
  agentId: string;
  missionId: string;
  tenantId: string;
  query: string;
  sources: ResearchSource[];
  findings: string;
  confidence: number;       // 0.0 – 1.0
  factChecked: boolean;
  flaggedForReview: boolean; // true if confidence < threshold
  executedAt: string;
  durationMs: number;
}

export interface ResearchConfig {
  /** Minimum confidence before auto-flagging for HITL review. Default: 0.7 */
  confidenceThreshold: number;
  /** Maximum number of sources to return. Default: 5 */
  maxSources: number;
  /** Maximum time to spend on research (ms). Default: 10000 */
  timeoutMs: number;
}

const DEFAULT_CONFIG: ResearchConfig = {
  confidenceThreshold: 0.7,
  maxSources: 5,
  timeoutMs: 10000,
};

// ============================================================
// Web Search Adapter
// Abstraction over search providers. For scaffold, uses a
// simulated search with realistic mock data. In production,
// plug in Serper, Tavily, or Brave Search API.
// ============================================================

interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Perform a web search. Currently uses simulated results.
 * Replace with a real search API (Serper, Tavily, etc.) in production.
 */
async function webSearch(query: string, maxResults: number): Promise<RawSearchResult[]> {
  // Simulated search results based on query keywords
  const keywords = query.toLowerCase().split(/\s+/);

  const mockDatabase: RawSearchResult[] = [
    {
      title: 'AWS Cost Management Best Practices - Amazon Web Services',
      url: 'https://docs.aws.amazon.com/cost-management/latest/userguide/best-practices.html',
      snippet: 'Learn how to manage and optimize your AWS costs using CloudWatch billing alarms, Cost Explorer, and budgets.',
    },
    {
      title: 'Slack API Documentation - Web API Methods',
      url: 'https://api.slack.com/methods',
      snippet: 'Complete reference for Slack Web API methods including chat.postMessage, files.upload, and conversations.list.',
    },
    {
      title: 'E-commerce Data Analysis: Pricing Trends 2025',
      url: 'https://example.com/ecommerce-pricing-trends',
      snippet: 'Analysis of global e-commerce pricing trends, including dynamic pricing algorithms and competitive analysis frameworks.',
    },
    {
      title: 'Web Scraping Best Practices and Legal Considerations',
      url: 'https://example.com/web-scraping-guide',
      snippet: 'Comprehensive guide to ethical web scraping, rate limiting, robots.txt compliance, and data extraction patterns.',
    },
    {
      title: 'PostgreSQL JSONB Queries - Performance Guide',
      url: 'https://www.postgresql.org/docs/current/functions-json.html',
      snippet: 'Reference for PostgreSQL JSON/JSONB operators and functions, GIN index strategies for document queries.',
    },
    {
      title: 'Email Deliverability Best Practices 2025',
      url: 'https://example.com/email-deliverability',
      snippet: 'Ensure high email deliverability with SPF, DKIM, DMARC configuration and engagement-based sending strategies.',
    },
    {
      title: 'Statistical Analysis Methods for Business Intelligence',
      url: 'https://example.com/statistical-analysis',
      snippet: 'Overview of regression analysis, time series forecasting, and anomaly detection for business data.',
    },
  ];

  // Score results by keyword relevance
  const scored = mockDatabase.map((result) => {
    const text = `${result.title} ${result.snippet}`.toLowerCase();
    const matchCount = keywords.filter((kw) => text.includes(kw)).length;
    const relevance = matchCount / Math.max(keywords.length, 1);
    return { ...result, relevance };
  });

  // Sort by relevance, filter above threshold, limit
  return scored
    .filter((r) => r.relevance > 0.1)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxResults);
}

// ============================================================
// Source Verification
// Cross-checks findings across multiple sources to compute
// a confidence score.
// ============================================================

function computeConfidence(sources: ResearchSource[]): number {
  if (sources.length === 0) return 0;

  // Weighted average of source relevance scores
  const avgRelevance =
    sources.reduce((sum, s) => sum + s.relevance, 0) / sources.length;

  // Source diversity bonus (more sources = higher confidence)
  const diversityBonus = Math.min(sources.length / 5, 1) * 0.2;

  // Domain authority bonus (known domains score higher)
  const authorityDomains = ['docs.aws.amazon.com', 'api.slack.com', 'postgresql.org', 'github.com'];
  const authorityCount = sources.filter((s) =>
    authorityDomains.some((d) => s.url.includes(d))
  ).length;
  const authorityBonus = (authorityCount / Math.max(sources.length, 1)) * 0.15;

  return Math.min(avgRelevance + diversityBonus + authorityBonus, 1.0);
}

function synthesizeFindings(query: string, sources: ResearchSource[]): string {
  if (sources.length === 0) {
    return `No relevant sources found for query: "${query}"`;
  }

  const topSources = sources.slice(0, 3);
  const snippets = topSources.map((s) => `• ${s.title}: ${s.snippet}`).join('\n');

  return `Research findings for "${query}":\n\n${snippets}\n\nBased on ${sources.length} source(s) with average relevance of ${(
    sources.reduce((sum, s) => sum + s.relevance, 0) / sources.length
  ).toFixed(2)}.`;
}

// ============================================================
// Main Research Function
// ============================================================

/**
 * Execute research for an agent's query.
 * Called before the agent executes its primary action when
 * requiresExternalData is true.
 */
export async function executeResearch(
  agentId: string,
  missionId: string,
  tenantId: string,
  query: string,
  config: Partial<ResearchConfig> = {}
): Promise<ResearchReport> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  const supabase = createServiceClient();

  // 1. Perform web search
  const rawResults = await webSearch(query, cfg.maxSources);

  // 2. Build source list with relevance scores
  const sources: ResearchSource[] = rawResults.map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.snippet,
    relevance: 'relevance' in r ? (r as RawSearchResult & { relevance: number }).relevance : 0.5,
  }));

  // 3. Compute confidence score
  const confidence = computeConfidence(sources);

  // 4. Synthesize findings
  const findings = synthesizeFindings(query, sources);

  // 5. Check if HITL review is needed
  const flaggedForReview = confidence < cfg.confidenceThreshold;

  const report: ResearchReport = {
    id: crypto.randomUUID(),
    agentId,
    missionId,
    tenantId,
    query,
    sources,
    findings,
    confidence,
    factChecked: sources.length >= 2, // At least 2 sources = cross-checked
    flaggedForReview,
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };

  // 6. Log to events
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: flaggedForReview ? 'agent.research_flagged' : 'agent.research_completed',
    entity_type: 'agent',
    entity_id: agentId,
    payload: {
      missionId,
      query,
      sourceCount: sources.length,
      confidence,
      flaggedForReview,
      durationMs: report.durationMs,
    },
  });

  return report;
}

/**
 * Batch research: execute multiple queries for different capabilities.
 */
export async function executeBatchResearch(
  agentId: string,
  missionId: string,
  tenantId: string,
  capabilities: string[],
  config: Partial<ResearchConfig> = {}
): Promise<ResearchReport[]> {
  const reports: ResearchReport[] = [];

  for (const capability of capabilities) {
    const query = `best practices and current data for: ${capability}`;
    const report = await executeResearch(agentId, missionId, tenantId, query, config);
    reports.push(report);
  }

  return reports;
}
