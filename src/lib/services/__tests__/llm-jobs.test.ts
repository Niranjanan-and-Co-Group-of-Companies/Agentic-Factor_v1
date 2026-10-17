import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// No database in tests: the router falls back to its built-in model chains.
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => { throw new Error('no database in tests'); } }));

import { callLLM, JOB_MODELS, usageByModel, withUsage } from '../llm-router';

let tried: string[] = [];
let unavailable = new Set<string>();

beforeEach(() => {
  tried = [];
  unavailable = new Set();
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const { model } = JSON.parse(init.body) as { model: string };
    tried.push(model);
    if (unavailable.has(model)) return new Response('{"type":"error","error":{"type":"not_found_error","message":"model not found"}}', { status: 404 });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' }), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('callLLM — the model is picked by the job', () => {
  it('builds on Sonnet, skipping a model the account cannot use, and remembers the one that worked', async () => {
    unavailable.add(JOB_MODELS.build[0]);
    const first = await callLLM([{ role: 'user', content: 'hi' }], { job: 'build' });
    expect(tried).toEqual([JOB_MODELS.build[0], JOB_MODELS.build[1]]);
    expect(first.model).toBe(JOB_MODELS.build[1]);

    tried = [];
    await callLLM([{ role: 'user', content: 'hi' }], { job: 'build' });
    expect(tried).toEqual([JOB_MODELS.build[1]]);
  });

  it('sends hard cases to Opus and simple checks to Haiku', async () => {
    expect((await callLLM([{ role: 'user', content: 'fix' }], { job: 'escalate' })).model).toBe('claude-opus-5-5');
    unavailable.add('claude-haiku-5-5');
    expect((await callLLM([{ role: 'user', content: 'repair' }], { job: 'light' })).model).toBe('claude-haiku-4-5-20251001');
  });
});

describe('withUsage — what a build step spent', () => {
  it('counts only the calls made inside it, also when steps run side by side', async () => {
    const step = (n: number) => withUsage(async () => {
      for (let i = 0; i < n; i++) await callLLM([{ role: 'user', content: 'x' }], { job: 'escalate' });
      return n;
    });
    const [a, b] = await Promise.all([step(1), step(2)]);
    expect(a.usage).toHaveLength(1);
    expect(usageByModel(b.usage)).toEqual({ 'claude-opus-5-5': { calls: 2, inputTokens: 20, outputTokens: 10 } });
    await callLLM([{ role: 'user', content: 'outside' }], { job: 'escalate' });
    expect(b.usage).toHaveLength(2);
  });
});
