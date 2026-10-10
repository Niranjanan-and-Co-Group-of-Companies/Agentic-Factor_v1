import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { verifySandboxLLMToken } from '@/lib/services/sandbox-llm-token';
import { generatePlatformImage, imageShape } from '@/lib/services/image-gen';

// ============================================================
// POST /api/sandbox/image — generate_image() in the sandbox SDK
//
// Generated visuals (pitch-deck art, post images) on the platform's own image models, billed to
// the tenant's credits under the agent's role. Same run-scoped token as /api/sandbox/llm.
// Body: { prompt: string, shape?: 'landscape' | 'square' | 'portrait', phase?: 'preview' | 'live' }
// Returns { url, mime_type, model, credits }: a short-lived link the SDK downloads.
//
// The preview's image is kept, and the live run gets the same image back for the same request —
// what the customer approved is what gets published, and it is paid for once.
// ============================================================

export const maxDuration = 120;

const MAX_PROMPT_CHARS = 4000;
const MAX_IMAGES_PER_TOKEN = 12;
const PREVIEW_EVENT = 'sandbox_image.preview';
const BUCKET = 'agent-images';

async function signedUrl(supabase: ReturnType<typeof createServiceClient>, path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 900);
  return data?.signedUrl ?? null;
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const claims = auth.startsWith('Bearer ') ? await verifySandboxLLMToken(auth.slice(7)) : null;
  if (!claims) return NextResponse.json({ error: 'Invalid or expired sandbox token' }, { status: 401 });

  const body = await request.json().catch(() => null) as { prompt?: unknown; shape?: unknown; phase?: unknown } | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: `prompt too long (max ${MAX_PROMPT_CHARS} characters)` }, { status: 413 });
  }
  const shape = imageShape(body?.shape);
  const phase = body?.phase === 'preview' || body?.phase === 'live' ? body.phase : null;
  const requestHash = createHash('sha256').update(JSON.stringify([prompt, shape])).digest('hex');

  const supabase = createServiceClient();

  // Live run: the preview's image for an identical request.
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
    const kept = previews?.[0]?.payload as { path?: string; mimeType?: string; model?: string } | undefined;
    const url = kept?.path ? await signedUrl(supabase, kept.path) : null;
    if (url) return NextResponse.json({ url, mime_type: kept!.mimeType, model: kept!.model, credits: 0, reused: true });
  }

  // Per-token cap: bounds what a runaway or manipulated script can spend.
  const { count } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'sandbox_image.call')
    .eq('entity_id', claims.tokenId);
  if ((count ?? 0) >= MAX_IMAGES_PER_TOKEN) {
    return NextResponse.json({ error: `Image limit reached for this agent run (${MAX_IMAGES_PER_TOKEN})` }, { status: 429 });
  }

  const { checkCredits, deductCredits, calculateUsdCreditCost } = await import('@/lib/middleware/billing');
  const creditCheck = await checkCredits(claims.tenantId, 30);
  if (!creditCheck.allowed) {
    return NextResponse.json({ error: creditCheck.reason ?? 'Insufficient credits' }, { status: 402 });
  }

  const { error: countErr } = await supabase.from('events').insert({
    tenant_id: claims.tenantId,
    event_type: 'sandbox_image.call',
    entity_type: 'agent',
    entity_id: claims.tokenId,
    payload: { missionId: claims.missionId, agentRole: claims.agentRole, promptChars: prompt.length, shape },
  });
  if (countErr) {
    console.error('[sandbox/image] could not record call:', countErr.message);
    return NextResponse.json({ error: 'Image call could not be recorded' }, { status: 503 });
  }

  let image;
  try {
    image = await generatePlatformImage(prompt, shape);
  } catch (err) {
    console.error('[sandbox/image] generation failed:', err);
    return NextResponse.json({ error: (err as Error).message.slice(0, 500) }, { status: 502 });
  }

  const credits = await calculateUsdCreditCost(image.costUsd);
  // actionType ends with ":<agent role>" so the run detail attributes it to this agent.
  await deductCredits(claims.tenantId, credits, `sandbox_image:${claims.agentRole}`, { provider: 'image', model: image.model })
    .catch(err => console.error('[sandbox/image] credit deduction failed:', err));

  const ext = image.mimeType.includes('jpeg') ? 'jpg' : image.mimeType.includes('webp') ? 'webp' : 'png';
  const path = `${claims.tenantId}/${claims.runId ?? 'no-run'}/${requestHash}.${ext}`;
  let { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, image.bytes, { contentType: image.mimeType, upsert: true });
  if (uploadErr && /bucket/i.test(uploadErr.message)) {
    // First image on this deployment: the private bucket is created on demand.
    await supabase.storage.createBucket(BUCKET, { public: false }).catch(() => {});
    ({ error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, image.bytes, { contentType: image.mimeType, upsert: true }));
  }
  const url = uploadErr ? null : await signedUrl(supabase, path);
  if (!url) {
    console.error('[sandbox/image] could not store image:', uploadErr?.message);
    return NextResponse.json({ error: 'The image was generated but could not be stored' }, { status: 503 });
  }

  if (phase === 'preview' && claims.runId) {
    const { error: previewErr } = await supabase.from('events').insert({
      tenant_id: claims.tenantId,
      event_type: PREVIEW_EVENT,
      entity_type: 'mission_run',
      entity_id: claims.runId,
      payload: { agentRole: claims.agentRole, requestHash, path, mimeType: image.mimeType, model: image.model },
    });
    if (previewErr) console.warn('[sandbox/image] could not store preview image record:', previewErr.message);
  }
  return NextResponse.json({ url, mime_type: image.mimeType, model: image.model, credits });
}
