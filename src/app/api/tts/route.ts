import { NextRequest } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 60;

// POST /api/tts
// Converts assistant response text to speech via OpenAI TTS.
// Uses tenant's own OpenAI key if connected; falls back to platform key.
// OpenAI tts-1 auto-detects language from text — works for all languages.
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const { text } = await request.json() as { text?: string };
    if (!text?.trim()) {
      return new Response('No text provided', { status: 400 });
    }

    // Resolve API key — tenant's own key preferred, then platform key
    let apiKey = process.env.OPENAI_API_KEY ?? '';
    try {
      const supabase = createServiceClient();
      const { data } = await supabase
        .from('tenant_permissions')
        .select('access_token')
        .eq('tenant_id', tenantId)
        .eq('provider', 'openai')
        .maybeSingle();
      if (data?.access_token && data.access_token !== 'composio_managed') {
        apiKey = data.access_token as string;
      }
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
