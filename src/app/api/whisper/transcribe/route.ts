import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import type { TranscriptionResult } from '@/lib/contracts';
import { transcribeSpeech } from '@/lib/services/speech';
import { chargeVoice, speechKeys } from '@/lib/services/voice-billing';

/** A file name with the recording's real extension (m4a from phones, mp4 from Safari, webm from Chrome). */
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

const MIME_BY_EXT: Record<string, string> = { m4a: 'audio/m4a', mp4: 'audio/mp4', mp3: 'audio/mpeg', mpeg: 'audio/mpeg', mpga: 'audio/mpeg', wav: 'audio/wav', webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac' };

/** Less real voice than this (measured on the device) is not speech: nothing is sent to an engine. */
const MIN_VOICED_MS = 300;

export const maxDuration = 60;

// POST /api/whisper/transcribe  (multipart: audio, and from the app and website voicedMs + durationMs)
// The recording's words, in the language spoken. The engine is chosen for the customer's language
// (src/lib/services/speech.ts). A recording the device measured as (almost) no voice is never
// transcribed: engines invent sentences from silence.
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const formData = await request.formData();
    const audio = formData.get('audio') as File | null;
    if (!audio || audio.size === 0) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    const voicedMs = Number(formData.get('voicedMs'));
    if (formData.has('voicedMs') && Number.isFinite(voicedMs) && voicedMs < MIN_VOICED_MS) {
      return NextResponse.json({ text: '', language: null, noSpeech: true } satisfies TranscriptionResult);
    }
    const durationMs = Number(formData.get('durationMs'));
    // Length for costs when the engine doesn't report it: as measured, or from the size (≥ 64 kbps).
    const seconds = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : audio.size / 8000;

    const keys = await speechKeys(tenantId);
    if (!keys.openai && !keys.gemini) {
      return NextResponse.json({ error: 'Voice input is not set up yet. Please type your message.' }, { status: 503 });
    }
    const fileName = audioFileName(audio);
    const heard = await transcribeSpeech(audio, {
      fileName,
      mimeType: audio.type || MIME_BY_EXT[fileName.split('.').pop() ?? ''] || 'audio/m4a',
      language: authResult.language ?? null,
      seconds,
    }, keys);
    if (!heard.own) await chargeVoice(tenantId, heard.costUsd, 'voice_transcription', heard.engine);
    return NextResponse.json({ text: heard.text, language: heard.language } satisfies TranscriptionResult);
  } catch (err) {
    console.error('[whisper/transcribe]', err);
    return NextResponse.json({ error: 'Couldn’t turn that into text. Please try again or type it.' }, { status: 500 });
  }
}
