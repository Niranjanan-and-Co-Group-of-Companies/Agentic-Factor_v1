import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { verifySandboxLLMToken } from '@/lib/services/sandbox-llm-token';

// ============================================================
// POST /api/sandbox/llm — runtime AI for agent code (ask_ai() in the sandbox SDK)
//
// Lets an agent summarise, write or analyse live data while it runs instead of hard-coding
// long text into its script. Authenticated by a run-scoped token minted per agent execution;
// billed to the tenant's credits under the agent's role so it shows on the run.
// Body: { prompt: string, system?: string, max_tokens?: number, json?: boolean, phase?: 'preview' | 'live' }
//
// The script runs twice: a preview (dry run) that the critic and the customer review, then the live
// run that performs the writes. Text generated in the preview is stored per run, and the live run gets
// the same text back for the same request — so what was approved is what gets written, at no extra cost.
// ============================================================

export const maxDuration = 120;

const MAX_INPUT_CHARS = 60_000;
const MAX_OUTPUT_TOKENS = 4000;
const MAX_CALLS_PER_TOKEN = 40;
const PREVIEW_EVENT = 'sandbox_llm.preview';

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const claims = auth.startsWith('Bearer ') ? await verifySandboxLLMToken(auth.slice(7)) : null;
  if (!claims) return NextResponse.json({ error: 'Invalid or expired sandbox token' }, { status: 401 });

  const body = await request.json().catch(() => null) as
    { prompt?: unknown; system?: unknown; max_tokens?: unknown; json?: unknown; phase?: unknown } | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
  const system = typeof body?.system === 'string' ? body.system : '';
  if (!prompt.trim()) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  if (prompt.length + system.length > MAX_INPUT_CHARS) {
    return NextResponse.json({ error: `prompt too long (max ${MAX_INPUT_CHARS} characters including system)` }, { status: 413 });
  }
  const maxTokens = Math.min(Math.max(Number(body?.max_tokens) || 1500, 64), MAX_OUTPUT_TOKENS);
  const jsonMode = body?.json === true;
  const phase = body?.phase === 'preview' || body?.phase === 'live' ? body.phase : null;
  const requestHash = createHash('sha256').update(JSON.stringify([system, prompt, maxTokens, jsonMode])).digest('hex');

  const supabase = createServiceClient();

  // Live run: hand back the preview's text for an identical request (latest preview attempt wins).
  if (phase === 'live' && claims.runId) {
    const { data: previews } = await supabase
      .from('events')
      .select('payload')
      .eq('tenant_id', claims.tenantId)
      .eq('event_type', PREVIEW_EVENT)
      .eq('entity_id', claims.runId)
      .eq('payload->>agentRole', claims.agentRole)
      .eq('payload->>requestHash', requestHash)
      .order('created_at', { ascending: false })
      .limit(1);
    const text = previews?.[0]?.payload?.text;
    if (typeof text === 'string') return NextResponse.json({ text, model: previews![0].payload.model, credits: 0, reused: true });
  }

  // Per-token call cap: bounds what a runaway or manipulated script can spend.
  const { count } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'sandbox_llm.call')
    .eq('entity_id', claims.tokenId);
  if ((count ?? 0) >= MAX_CALLS_PER_TOKEN) {
    return NextResponse.json({ error: `AI call limit reached for this agent run (${MAX_CALLS_PER_TOKEN})` }, { status: 429 });
  }

  const { checkCredits, deductCredits, calculateLLMCreditCost } = await import('@/lib/middleware/billing');
  const creditCheck = await checkCredits(claims.tenantId, 2);
  if (!creditCheck.allowed) {
    return NextResponse.json({ error: creditCheck.reason ?? 'Insufficient credits' }, { status: 402 });
  }

  const { error: countErr } = await supabase.from('events').insert({
    tenant_id: claims.tenantId,
    event_type: 'sandbox_llm.call',
    entity_type: 'agent',
    entity_id: claims.tokenId,
    payload: { missionId: claims.missionId, agentRole: claims.agentRole, promptChars: prompt.length, maxTokens },
  });
  if (countErr) {
    // Without the record the per-token cap can't be enforced — refuse rather than run uncapped.
    console.error('[sandbox/llm] could not record call:', countErr.message);
    return NextResponse.json({ error: 'AI call could not be recorded' }, { status: 503 });
  }

  try {
    const { callLLM } = await import('@/lib/services/llm-router');
    const result = await callLLM(
      [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user' as const, content: prompt },
      ],
      { tier: 2, jsonMode, maxTokens, temperature: 0.4 },
    );
    const credits = await calculateLLMCreditCost(result.model, result.inputTokens ?? 0, result.outputTokens ?? 0);
    // actionType ends with ":<agent role>" so the run detail attributes it to this agent.
    await deductCredits(claims.tenantId, credits, `sandbox_llm:${claims.agentRole}`, {
      provider: result.provider, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    }).catch(err => console.error('[sandbox/llm] credit deduction failed:', err));
    if (phase === 'preview' && claims.runId) {
      const { error: previewErr } = await supabase.from('events').insert({
        tenant_id: claims.tenantId,
        event_type: PREVIEW_EVENT,
        entity_type: 'mission_run',
        entity_id: claims.runId,
        payload: { agentRole: claims.agentRole, requestHash, text: result.content, model: result.model },
      });
      if (previewErr) console.warn('[sandbox/llm] could not store preview text:', previewErr.message);
    }
    return NextResponse.json({ text: result.content, model: result.model, credits });
  } catch (err) {
    console.error('[sandbox/llm] LLM call failed:', err);
    return NextResponse.json({ error: 'AI call failed', detail: (err as Error).message.slice(0, 300) }, { status: 502 });
  }
}
