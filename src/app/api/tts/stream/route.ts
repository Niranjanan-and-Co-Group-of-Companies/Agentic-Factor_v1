import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { speakableText, streamSpeech } from '@/lib/services/speech';
import { chargeVoice, speechKeys } from '@/lib/services/voice-billing';

export const maxDuration = 60;

/** One piece of a reply at a time (a sentence or a few): enough for smooth back-to-back playback. */
const MAX_CHARS = 1200;

// POST /api/tts/stream { text } → the voice for that text as it is made: raw 16-bit little-endian PCM,
// 24 kHz mono. The app and the website send a reply sentence by sentence while it is still being written
// and play the pieces back to back (src/lib/contracts/speech.ts). Billed like chat, at real cost × 3,
// unless the customer's own key paid.
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { text } = await request.json().catch(() => ({})) as { text?: string };
  const speech = speakableText(String(text ?? '')).slice(0, MAX_CHARS);
  if (!speech) return new Response(null, { status: 204 });
  const keys = await speechKeys(tenantId);
  if (!keys.openai && !keys.gemini) return NextResponse.json({ error: 'Read aloud is not set up yet.' }, { status: 503 });
  const stream = streamSpeech(speech, keys, async paid => {
    if (!paid.own) await chargeVoice(tenantId, paid.costUsd, 'voice_speech', paid.engine);
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'audio/L16; rate=24000; channels=1',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
