import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { speechParts, synthesizeSpeech } from '@/lib/services/speech';
import { chargeVoice, speechKeys } from '@/lib/services/voice-billing';

export const maxDuration = 60;

// Replies read aloud, in parts (a short first part, so speech starts quickly):
//   GET  /api/tts?messageId=…&parts=1     → { parts: N }  — how many parts a saved reply has
//   GET  /api/tts?messageId=…&part=i      → part i as audio (WAV); the text is this account's saved reply
//   POST /api/tts { text, part? }         → part `part` (default 0) of any text, as audio
// The engine (Google's Gemini TTS, OpenAI as fallback) reads the language from the text itself. Billed
// at real cost × 3, unless the customer's own key paid.
export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const params = request.nextUrl.searchParams;
  const messageId = params.get('messageId');
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });
  const { data } = await createServiceClient().from('mission_chat_messages').select('content')
    .eq('id', messageId).eq('tenant_id', authResult.tenantId).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parts = speechParts(String(data.content ?? ''));
  if (params.get('parts')) return NextResponse.json({ parts: parts.length });
  return speak(authResult.tenantId, parts, Number(params.get('part') ?? 0));
}

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { text, part } = await request.json().catch(() => ({})) as { text?: string; part?: number };
  return speak(authResult.tenantId, speechParts(text ?? ''), Number(part ?? 0));
}

async function speak(tenantId: string, parts: string[], index: number): Promise<Response> {
  if (parts.length === 0) return NextResponse.json({ error: 'Nothing to read aloud' }, { status: 400 });
  if (!Number.isInteger(index) || index < 0 || index >= parts.length) {
    return NextResponse.json({ error: 'No such part' }, { status: 416 });
  }
  try {
    const keys = await speechKeys(tenantId);
    if (!keys.openai && !keys.gemini) return NextResponse.json({ error: 'Read aloud is not set up yet.' }, { status: 503 });
    const spoken = await synthesizeSpeech(parts[index], keys);
    if (!spoken.own) await chargeVoice(tenantId, spoken.costUsd, 'voice_speech', spoken.engine);
    return new Response(Buffer.from(spoken.audio), {
      headers: {
        'Content-Type': spoken.mimeType,
        'Content-Length': String(spoken.audio.length),
        'Cache-Control': 'private, no-store',
        'X-Speech-Parts': String(parts.length),
      },
    });
  } catch (err) {
    console.error('[tts]', err);
    return NextResponse.json({ error: 'Couldn’t read this aloud. Please try again.' }, { status: 500 });
  }
}
