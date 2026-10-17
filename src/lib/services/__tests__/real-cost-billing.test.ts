/* eslint-disable @typescript-eslint/no-explicit-any -- a deliberately loose stand-in for the Supabase client */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory Supabase stand-in (events table + the refund RPC) ──
type Row = Record<string, any>;
let events: Row[] = [];
let refunds: Array<{ amount: number; reason: string }> = [];
function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let limitN: number | undefined;
  let inserted: Row | null = null;
  const pick = (r: Row, path: string) => {
    const [col, key] = path.split('->>');
    return key ? r[col]?.[key] : r[col];
  };
  const run = () => {
    const out = (table === 'events' ? events : []).filter(r => filters.every(f => f(r)));
    return limitN != null ? out.slice(0, limitN) : out;
  };
  const q: any = {
    select() { return q; },
    eq(col: string, v: unknown) { filters.push(r => pick(r, col) === v); return q; },
    limit(n: number) { limitN = n; return q; },
    insert(o: Row) { inserted = o; events.push(o); return q; },
    maybeSingle() { return Promise.resolve({ data: run()[0] ?? null, error: null }); },
    then(res: any, rej: any) { return Promise.resolve(inserted ? { data: null, error: null } : { data: run(), error: null }).then(res, rej); },
  };
  return q;
}
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from,
    rpc: (name: string, args: Row) => {
      if (name === 'add_credits_atomic_refund') refunds.push({ amount: args.p_amount, reason: args.p_reason });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));
vi.mock('@/lib/services/fx-rate', () => ({ getUsdToInr: async () => 87 }));

import { tokenCostUsd, sandboxCostUsd, toolCostUsd } from '../prices';
import { creditsForCost, creditsChargedFor, settleFailure, MARKUP } from '@/lib/middleware/billing';
import { parseUsageProbe } from '../run-billing';
import { cachedSystem, CACHE_SPLIT, plainSystem, withCachedHistory } from '../claude-chat';

beforeEach(() => { events = []; refunds = []; });

describe('prices — what each call really costs us', () => {
  it('prices tokens by model, cached tokens at their own rate', () => {
    // Sonnet 5.5: $2 in, $10 out, $2.50 cache write, $0.10 cache read per million.
    expect(tokenCostUsd('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(2);
    expect(tokenCostUsd('claude-sonnet-5-5', { inputTokens: 1000, outputTokens: 1000, cacheWriteTokens: 1000, cacheReadTokens: 10_000 }))
      .toBeCloseTo((1000 * 2 + 1000 * 10 + 1000 * 2.5 + 10_000 * 0.1) / 1e6);
    // Sonnet 5 is not priced as Sonnet 5.5 (its cache reads cost twice as much).
    expect(tokenCostUsd('claude-sonnet-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(tokenCostUsd('claude-opus-5-5', { inputTokens: 7380, outputTokens: 1699 })).toBeCloseTo((7380 * 4 + 1699 * 20) / 1e6);
  });
  it('uses the long-prompt price above the threshold, and Opus for an unknown model', () => {
    expect(tokenCostUsd('claude-haiku-5-5', { inputTokens: 50_000, outputTokens: 0 })).toBeCloseTo(0.005);
    expect(tokenCostUsd('claude-haiku-5-5', { inputTokens: 150_000, outputTokens: 0 })).toBeCloseTo(0.075);
    expect(tokenCostUsd('some-new-model', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(4);
  });
  it('prices sandbox seconds, app actions and searches', () => {
    expect(sandboxCostUsd(60)).toBeCloseTo(60 * (2 * 0.000014 + 4 * 0.0000045));
    expect(toolCostUsd({ composioCalls: 10, tavilyCredits: 2 })).toBeCloseTo(10 * 0.0005 + 2 * 0.008);
  });
});

describe('credits — real cost × live rate × markup, rounded up', () => {
  it('applies the markup for the kind of work', async () => {
    expect(MARKUP).toEqual({ work: 4, chat: 3, failure: 1.75 });
    expect(await creditsForCost(0.30, 'work')).toBe(105);      // 0.30 × 87 × 4 = 104.4
    expect(await creditsForCost(0.30, 'failure')).toBe(46);    // 0.30 × 87 × 1.75 = 45.675
    expect(await creditsForCost(0.022, 'chat')).toBe(6);       // 0.022 × 87 × 3 = 5.74
    expect(await creditsForCost(0.0001, 'work')).toBe(1);      // never less than 1
  });
});

describe('settleFailure — a failed run or build is billed at 1.75×', () => {
  const charge = (amount: number, realCostUsd: number, runId = 'R1') =>
    events.push({ tenant_id: 'T', event_type: 'billing.credit_used', payload: { amount, realCostUsd, markup: 'work', runId } });

  it('refunds what was charged down to the failure rate, once', async () => {
    charge(70, 0.2);
    charge(35, 0.1);
    // Real cost $0.30 → 0.30 × 87 × 1.75 = 45.68 → 46 credits; 105 were charged.
    expect(await settleFailure('T', { runId: 'R1' })).toEqual({ charged: 46, refunded: 59 });
    expect(refunds).toEqual([{ amount: 59, reason: 'failure_rate:runId:R1' }]);
    expect(await settleFailure('T', { runId: 'R1' })).toEqual({ charged: 46, refunded: 59 });
    expect(refunds).toHaveLength(1);
    expect(await creditsChargedFor('T', { runId: 'R1' })).toBe(46);
  });
  it('leaves other runs alone and does nothing when nothing was charged', async () => {
    charge(70, 0.2, 'R2');
    expect(await settleFailure('T', { runId: 'R1' })).toEqual({ charged: 0, refunded: 0 });
    expect(refunds).toHaveLength(0);
  });
  it('scales down charges recorded without a real cost', async () => {
    events.push({ tenant_id: 'T', event_type: 'billing.credit_used', payload: { amount: 40, markup: 'work', jobId: 'J' } });
    expect(await settleFailure('T', { jobId: 'J' })).toEqual({ charged: 18, refunded: 22 }); // 40 × 1.75 / 4 = 17.5
  });
});

describe('parseUsageProbe — what a script used, as counted in the sandbox', () => {
  it('reads the counters and ignores anything else', () => {
    expect(parseUsageProbe('hello\n__AF_USAGE__{"composioCalls": 7, "tavilyCredits": 2, "serpapiSearches": 0}'))
      .toEqual({ composioCalls: 7, tavilyCredits: 2, serpapiSearches: 0 });
    expect(parseUsageProbe('__AF_USAGE__{"composioCalls": -3, "tavilyCredits": "x"}')).toEqual({ composioCalls: 0, tavilyCredits: 0, serpapiSearches: 0 });
    expect(parseUsageProbe('no probe output')).toEqual({});
  });
});

describe('prompt caching — fixed parts cached, the per-turn part not', () => {
  it('caches every system part but the last', () => {
    const blocks = cachedSystem(`rules${CACHE_SPLIT}mission${CACHE_SPLIT}today`) as Array<Record<string, unknown>>;
    expect(blocks.map(b => b.text)).toEqual(['rules', 'mission', 'today']);
    expect(blocks.map(b => !!b.cache_control)).toEqual([true, true, false]);
    expect(cachedSystem('one part')).toBe('one part');
    expect(plainSystem(`a${CACHE_SPLIT}b`)).toBe('a\n\nb');
  });
  it('puts a cache point on the last message, never on a thinking block', () => {
    const [m1, m2] = withCachedHistory([{ role: 'user', content: 'hi' }, { role: 'user', content: 'run it' }]);
    expect(m1.content).toBe('hi');
    expect(m2.content).toEqual([{ type: 'text', text: 'run it', cache_control: { type: 'ephemeral' } }]);
    const [a] = withCachedHistory([{ role: 'assistant', content: [{ type: 'text', text: 'x' }, { type: 'thinking', thinking: 'y' }] }]);
    expect(a.content).toEqual([{ type: 'text', text: 'x', cache_control: { type: 'ephemeral' } }, { type: 'thinking', thinking: 'y' }]);
  });
});
