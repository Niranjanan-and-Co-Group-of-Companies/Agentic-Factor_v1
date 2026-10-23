import { NextRequest } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { readDecryptedToken } from '@/lib/services/vault';
import { chargeVoice } from '@/lib/services/voice-billing';
import { TTS_USD_PER_CHAR } from '@/lib/services/prices';

export const maxDuration = 60;

// POST /api/tts { text }          — the website reads a reply aloud.
// GET  /api/tts?messageId=…        — the app plays a saved reply (an audio player can't POST): the text
//                                     comes from this account's own saved message.
// OpenAI tts-1 auto-detects the language from the text — it speaks Hindi, Tamil… as written.
// Uses the tenant's own OpenAI key if connected; otherwise the platform's, billed at real cost × 3.
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { text } = await request.json().catch(() => ({})) as { text?: string };
  return speak(authResult.tenantId, text ?? '');
}

export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const messageId = request.nextUrl.searchParams.get('messageId');
  if (!messageId) return new Response('messageId required', { status: 400 });
  const { data } = await createServiceClient().from('mission_chat_messages').select('content')
    .eq('id', messageId).eq('tenant_id', authResult.tenantId).maybeSingle();
  if (!data) return new Response('Not found', { status: 404 });
  return speak(authResult.tenantId, String(data.content ?? ''));
}

async function speak(tenantId: string, text: string): Promise<Response> {
  try {
    if (!text.trim()) {
      return new Response('No text provided', { status: 400 });
    }

    // Resolve API key — tenant's own key preferred, then platform key (billed at real cost when it's ours)
    let apiKey = process.env.OPENAI_API_KEY ?? '';
    let ownKey = false;
    try {
      const tenantKey = await readDecryptedToken(tenantId, 'openai');
      if (tenantKey) { apiKey = tenantKey; ownKey = true; }
    } catch { /* use platform key */ }

    if (!apiKey) {
      return new Response('TTS requires an OpenAI API key', { status: 400 });
    }

    // Strip markdown and platform-internal tags before TTS
    const cleaned = text
      .replace(/<action>[\s\S]*?<\/action>/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`{3}[\s\S]*?`{3}/gm, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!cleaned) return new Response('Nothing to speak', { status: 400 });

    // Cap at 2000 chars to keep latency and cost reasonable
    const input = cleaned.length > 2000 ? cleaned.slice(0, 2000) + '…' : cleaned;

    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'nova', // nova handles multilingual content well
        input,
      }),
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      console.error('[tts]', err);
      return new Response('TTS failed', { status: 500 });
    }
    if (!ownKey) await chargeVoice(tenantId, input.length * TTS_USD_PER_CHAR, 'voice_speech', 'tts-1');

    return new Response(ttsRes.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (err) {
    console.error('[tts/route]', err);
    return new Response('TTS failed', { status: 500 });
  }
}
