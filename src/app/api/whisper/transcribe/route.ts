import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { readDecryptedToken } from '@/lib/services/vault';
import { chargeVoice } from '@/lib/services/voice-billing';
import { WHISPER_USD_PER_MINUTE } from '@/lib/services/prices';

/** A file name with the recording's real extension (m4a from phones, webm from browsers). */
function audioFileName(audio: File): string {
  const fromName = /\.(m4a|mp4|mp3|mpeg|mpga|wav|webm|ogg|oga|flac)$/i.exec(audio.name ?? '')?.[1];
  if (fromName) return `audio.${fromName.toLowerCase()}`;
  const type = (audio.type ?? '').toLowerCase();
  const ext = type.includes('mp4') || type.includes('m4a') || type.includes('aac') ? 'm4a'
    : type.includes('mpeg') || type.includes('mp3') ? 'mp3'
    : type.includes('wav') ? 'wav'
    : type.includes('ogg') ? 'ogg'
    : 'webm';
  return `audio.${ext}`;
}

export const maxDuration = 60;

// POST /api/whisper/transcribe
// Accepts a multipart audio blob, transcribes via OpenAI Whisper.
// Uses the tenant's own OpenAI key if connected; falls back to platform key.
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const formData = await request.formData();
    const audio = formData.get('audio') as File | null;
    if (!audio) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Resolve API key — tenant's own key preferred, then platform key (billed at real cost when it's ours)
    let apiKey = process.env.OPENAI_API_KEY ?? '';
    let ownKey = false;
    try {
      const tenantKey = await readDecryptedToken(tenantId, 'openai');
      if (tenantKey) { apiKey = tenantKey; ownKey = true; }
    } catch { /* use platform key */ }

    if (!apiKey) {
      return NextResponse.json({ error: 'Voice input requires an OpenAI API key. Connect OpenAI in the Connectors page.' }, { status: 400 });
    }

    // Forward to OpenAI Whisper, named for its real format — OpenAI reads the format from the name, and
    // phones record m4a (every recording used to be sent as "audio.webm").
    const whisperForm = new FormData();
    whisperForm.append('file', audio, audioFileName(audio));
    whisperForm.append('model', 'whisper-1');
    // verbose_json: the language heard and the length, for billing
    whisperForm.append('response_format', 'verbose_json');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: whisperForm,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[whisper]', err);
      return NextResponse.json({ error: 'Transcription failed. Please try typing your message.' }, { status: 500 });
    }

    const data = await res.json() as { text?: string; language?: string; duration?: number };
    if (!ownKey && data.duration) await chargeVoice(tenantId, (data.duration / 60) * WHISPER_USD_PER_MINUTE, 'voice_transcription', 'whisper-1');
    return NextResponse.json({ text: data.text ?? '', language: data.language ?? null });
  } catch (err) {
    console.error('[whisper/transcribe]', err);
    return NextResponse.json({ error: 'Transcription failed.' }, { status: 500 });
  }
}
