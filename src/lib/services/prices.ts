// What the services we use charge us, in USD, from their official pricing pages (checked 17 Oct 2026):
//   Claude    https://platform.claude.com/docs/en/about-claude/pricing
//   Gemini    https://ai.google.dev/gemini-api/docs/pricing
//   OpenAI    https://openai.com/api/pricing
//   E2B       https://e2b.dev/pricing
//   Composio  https://composio.dev/pricing
//   Tavily    https://www.tavily.com/pricing
// Customers are billed from these real costs (see creditsForCost in middleware/billing.ts); update a
// price here when a provider changes it.

/** USD per million tokens. cacheWrite is the 5-minute cache write; cacheRead a cache hit. */
export interface TokenPrices { input: number; output: number; cacheWrite: number; cacheRead: number }

interface PriceEntry extends TokenPrices {
  /** Prompts longer than this many tokens are billed at `long` instead. */
  longAbove?: number;
  long?: TokenPrices;
}

// Longest prefix first, so claude-sonnet-5-5 is not priced as claude-sonnet-5.
const MODEL_PRICES: Array<[string, PriceEntry]> = ([
  ['claude-fable-5-1', { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 }],
  ['claude-fable-5', { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }],
  ['claude-opus-5', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-7', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 }],
  ['claude-sonnet-4-6', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }],
  ['claude-haiku-5-5', {
    input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01,
    longAbove: 100_000, long: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 },
  }],
  ['claude-haiku-4-5', { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }],
  ['gemini-2.5-pro', {
    input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125,
    longAbove: 200_000, long: { input: 2.5, output: 15, cacheWrite: 2.5, cacheRead: 0.25 },
  }],
  ['gemini-2.5-flash', { input: 0.3, output: 2.5, cacheWrite: 0.3, cacheRead: 0.03 }],
  ['gemini-2.0-flash', { input: 0.1, output: 0.4, cacheWrite: 0.1, cacheRead: 0.025 }],
  ['gpt-4o-mini', { input: 0.15, output: 0.6, cacheWrite: 0.15, cacheRead: 0.075 }],
  ['gpt-4o', { input: 2.5, output: 10, cacheWrite: 2.5, cacheRead: 1.25 }],
] as Array<[string, PriceEntry]>).sort((a, b) => b[0].length - a[0].length);

/** A model we have no price for is billed at the most expensive Claude model we use, never for free. */
const UNKNOWN_MODEL: PriceEntry = MODEL_PRICES.find(([m]) => m === 'claude-opus-5-5')![1];

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to the prompt cache (billed above the input price). */
  cacheWriteTokens?: number;
  /** Tokens read from the prompt cache (billed far below the input price). */
  cacheReadTokens?: number;
}

export function modelPrices(model: string): PriceEntry | null {
  const id = model.toLowerCase();
  return MODEL_PRICES.find(([prefix]) => id.startsWith(prefix) || id.includes(prefix))?.[1] ?? null;
}

/** What one model call cost us, in USD. */
export function tokenCostUsd(model: string, usage: TokenUsage): number {
  const entry = modelPrices(model);
  if (!entry) console.warn(`[prices] No price for model "${model}" — billing it at the Opus price.`);
  const base = entry ?? UNKNOWN_MODEL;
  const prompt = usage.inputTokens + (usage.cacheWriteTokens ?? 0) + (usage.cacheReadTokens ?? 0);
  const p = base.long && base.longAbove && prompt > base.longAbove ? base.long : base;
  return (
    usage.inputTokens * p.input +
    usage.outputTokens * p.output +
    (usage.cacheWriteTokens ?? 0) * p.cacheWrite +
    (usage.cacheReadTokens ?? 0) * p.cacheRead
  ) / 1_000_000;
}

/** What a set of model calls cost us, in USD. */
export function usageCostUsd(usage: Array<TokenUsage & { model: string }>): number {
  return usage.reduce((sum, u) => sum + tokenCostUsd(u.model, u), 0);
}

// ── Everything else a run uses ──

/** E2B, default sandbox (2 vCPU at $0.000014/vCPU-s + 4 GiB at $0.0000045/GiB-s): per second it is alive. */
export const SANDBOX_USD_PER_SECOND = 2 * 0.000014 + 4 * 0.0000045;
/** Composio, per tool call beyond the plan's included calls ($0.0005 with Composio-managed app logins). */
export const COMPOSIO_USD_PER_CALL = 0.0005;
/** Tavily pay-as-you-go, per API credit (basic search = 1 credit, advanced = 2). */
export const TAVILY_USD_PER_CREDIT = 0.008;
/** SerpAPI (search fallback), per search on the Developer plan ($75 for 5,000). */
export const SERPAPI_USD_PER_SEARCH = 0.015;
/** OpenAI speech to text (whisper-1), per minute of audio. */
export const WHISPER_USD_PER_MINUTE = 0.006;
/** OpenAI text to speech (tts-1), per character spoken ($15 per million). */
export const TTS_USD_PER_CHAR = 15 / 1_000_000;

/** What a script used beyond AI calls, as counted inside the sandbox. */
export interface ToolUsage { composioCalls?: number; tavilyCredits?: number; serpapiSearches?: number }

export function toolCostUsd(usage: ToolUsage): number {
  return (usage.composioCalls ?? 0) * COMPOSIO_USD_PER_CALL
    + (usage.tavilyCredits ?? 0) * TAVILY_USD_PER_CREDIT
    + (usage.serpapiSearches ?? 0) * SERPAPI_USD_PER_SEARCH;
}

export function sandboxCostUsd(seconds: number): number {
  return Math.max(0, seconds) * SANDBOX_USD_PER_SECOND;
}
