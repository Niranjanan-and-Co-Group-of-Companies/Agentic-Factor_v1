// Voice for the chat, from the engine that handles each language best.
//
//   Hearing (speech → text): Google's transcription model for the Indian languages it lists (Hindi,
//   Malayalam, Kannada, Telugu…); OpenAI's (gpt-transcribe) for every other language and when the
//   customer hasn't chosen one. If one engine fails, the other is tried.
//   Speaking (text → speech): Google's Gemini TTS — 130+ languages, Malayalam and Tamil included —
//   with OpenAI's tts-1 as the fallback. Long replies are spoken in parts, so the first words play
//   quickly and no single answer is too big to send.
//
// Every result carries its real cost, from the engine's own usage report where it gives one, and
// whether the customer's own key paid for it (then nothing is billed).

import { languageOf } from '@/lib/contracts';
import {
  GEMINI_TRANSCRIBE_USD_PER_M, OPENAI_MINI_TRANSCRIBE_USD_PER_MINUTE, OPENAI_TRANSCRIBE_USD_PER_MINUTE,
  TTS_USD_PER_CHAR, geminiTtsUsdPerM,
} from './prices';

const GEMINI_INTERACTIONS = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const GEMINI_STT_MODEL = 'gemini-3.5-transcribe';
const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
const GEMINI_VOICE = 'Sulafat'; // warm
const SPEECH_STYLE = 'Warm, clear and natural, like a helpful personal assistant. Use a native accent for the language of the text.';

export interface EngineKey { key: string; /** The customer's own key: nothing is billed. */ own: boolean }
export interface EngineKeys { openai?: EngineKey | null; gemini?: EngineKey | null }

interface Paid { costUsd: number; own: boolean; engine: string }
export interface Heard extends Paid { text: string; language: string | null }
export interface Spoken extends Paid { audio: Uint8Array; mimeType: string }

type Fetch = typeof fetch;

// ── Hearing ──

/** Gemini lists m4a (not mp4, the same container Safari records) and webm. */
function geminiMime(mimeType: string): string {
  const t = mimeType.toLowerCase();
  if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'audio/m4a';
  if (t.includes('webm')) return 'audio/webm';
  if (t.includes('ogg')) return 'audio/ogg';
  if (t.includes('wav')) return 'audio/wav';
  if (t.includes('mpeg') || t.includes('mp3')) return 'audio/mp3';
  return 'audio/m4a';
}

function outputText(data: Record<string, unknown>): string {
  if (typeof data.output_text === 'string') return data.output_text;
  const steps = Array.isArray(data.steps) ? data.steps as Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> : [];
  return steps.filter(s => s.type === 'model_output')
    .flatMap(s => s.content ?? []).filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text).join(' ');
}

function usageOf(data: Record<string, unknown>): { input: number; output: number } | null {
  const u = data.usage as { total_input_tokens?: number; total_output_tokens?: number } | undefined;
  return u && typeof u.total_input_tokens === 'number' ? { input: u.total_input_tokens, output: u.total_output_tokens ?? 0 } : null;
}

async function geminiTranscribe(audio: Blob, mimeType: string, language: string | null, seconds: number, key: EngineKey, fetchImpl: Fetch): Promise<Heard> {
  const locale = languageOf(language)?.googleLocale;
  const data64 = Buffer.from(await audio.arrayBuffer()).toString('base64');
  const res = await fetchImpl(GEMINI_INTERACTIONS, {
    method: 'POST',
    headers: { 'x-goog-api-key': key.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEMINI_STT_MODEL,
      input: [{ type: 'audio', data: data64, mime_type: geminiMime(mimeType) }],
      // The language and English: Indians mix the two ("Manglish", "Hinglish").
      ...(locale ? { generation_config: { transcription_config: { language_codes: [locale, 'en-IN'] } } } : {}),
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Google transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as Record<string, unknown>;
  const usage = usageOf(data);
  const costUsd = usage
    ? (usage.input * GEMINI_TRANSCRIBE_USD_PER_M.audioIn + usage.output * GEMINI_TRANSCRIBE_USD_PER_M.textOut) / 1_000_000
    : (seconds * 25 * GEMINI_TRANSCRIBE_USD_PER_M.audioIn) / 1_000_000;
  return { text: outputText(data).trim(), language: language ?? null, costUsd, own: key.own, engine: GEMINI_STT_MODEL };
}

async function openaiTranscribe(audio: Blob, fileName: string, language: string | null, seconds: number, key: EngineKey, fetchImpl: Fetch): Promise<Heard> {
  const send = async (model: string) => {
    const form = new FormData();
    form.append('file', audio, fileName);
    form.append('model', model);
    form.append('response_format', 'json');
    if (language) {
      if (model === 'gpt-transcribe') {
        // Language hints; English too, since it is mixed into most Indian speech.
        for (const code of language === 'en' ? ['en'] : [language, 'en']) form.append('languages[]', code);
      } else {
        form.append('language', language);
      }
    }
    return fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key.key}` }, body: form, signal: AbortSignal.timeout(45_000),
    });
  };
  let model = 'gpt-transcribe';
  let res = await send(model);
  if (!res.ok && (res.status === 400 || res.status === 404)) {
    // The newest model isn't open to this key (or rejects the language): its predecessor.
    console.warn('[speech] gpt-transcribe refused:', res.status, (await res.text()).slice(0, 300));
    model = 'gpt-4o-mini-transcribe';
    res = await send(model);
  }
  if (!res.ok) throw new Error(`OpenAI transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { text?: string; languages?: Array<{ code?: string }>; language?: string; usage?: { type?: string; seconds?: number } };
  const billedSeconds = data.usage?.type === 'duration' && typeof data.usage.seconds === 'number' ? data.usage.seconds : seconds;
  const perMinute = model === 'gpt-transcribe' ? OPENAI_TRANSCRIBE_USD_PER_MINUTE : OPENAI_MINI_TRANSCRIBE_USD_PER_MINUTE;
  return {
    text: (data.text ?? '').trim(),
    language: data.languages?.[0]?.code ?? data.language ?? language ?? null,
    costUsd: (billedSeconds / 60) * perMinute,
    own: key.own,
    engine: model,
  };
}

/** A recording's words. `seconds` is its length (for costs when the engine doesn't report usage). */
export async function transcribeSpeech(
  audio: Blob,
  opts: { fileName: string; mimeType: string; language: string | null; seconds: number },
  keys: EngineKeys,
  fetchImpl: Fetch = fetch,
): Promise<Heard> {
  const google = keys.gemini ? () => geminiTranscribe(audio, opts.mimeType, opts.language, opts.seconds, keys.gemini!, fetchImpl) : null;
  const openai = keys.openai ? () => openaiTranscribe(audio, opts.fileName, opts.language, opts.seconds, keys.openai!, fetchImpl) : null;
  const order = languageOf(opts.language)?.googleLocale ? [google, openai] : [openai, google];
  let lastError: unknown = new Error('No speech engine is set up.');
  for (const engine of order) {
    if (!engine) continue;
    try {
      return await engine();
    } catch (err) {
      console.error('[speech] transcription failed, trying the other engine:', err);
      lastError = err;
    }
  }
  throw lastError;
}

// ── Speaking ──

/** Wraps raw 16-bit mono PCM in a WAV header. */
export function wavFromPcm(pcm: Uint8Array, sampleRate = 24_000): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

async function geminiSpeak(text: string, key: EngineKey, fetchImpl: Fetch): Promise<Spoken> {
  const res = await fetchImpl(GEMINI_INTERACTIONS, {
    method: 'POST',
    headers: { 'x-goog-api-key': key.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEMINI_TTS_MODEL,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: SPEECH_STYLE }] }] }],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24_000 },
      generation_config: { speech_config: [{ voice: GEMINI_VOICE }] },
    }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) throw new Error(`Google speech ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as Record<string, unknown>;
  const steps = Array.isArray(data.steps) ? data.steps as Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string }> }> : [];
  const audioPart = steps.filter(s => s.type === 'model_output').flatMap(s => s.content ?? []).filter(c => c.type === 'audio' && c.data).pop();
  if (!audioPart?.data) throw new Error('Google speech returned no audio.');
  let audio: Uint8Array = Buffer.from(audioPart.data, 'base64');
  let mimeType = audioPart.mime_type ?? 'audio/wav';
  if (/l16|pcm/i.test(mimeType)) { audio = wavFromPcm(audio); mimeType = 'audio/wav'; }
  const prices = geminiTtsUsdPerM();
  const usage = usageOf(data);
  const costUsd = usage
    ? (usage.input * prices.textIn + usage.output * prices.audioOut) / 1_000_000
    : (Math.max(0, audio.length - 44) / 48_000) * 25 * prices.audioOut / 1_000_000;
  return { audio, mimeType, costUsd, own: key.own, engine: GEMINI_TTS_MODEL };
}

async function openaiSpeak(text: string, key: EngineKey, fetchImpl: Fetch): Promise<Spoken> {
  const res = await fetchImpl('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: 'nova', input: text, response_format: 'wav' }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) throw new Error(`OpenAI speech ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { audio: new Uint8Array(await res.arrayBuffer()), mimeType: 'audio/wav', costUsd: text.length * TTS_USD_PER_CHAR, own: key.own, engine: 'tts-1' };
}

/** One part of a reply, spoken. */
export async function synthesizeSpeech(text: string, keys: EngineKeys, fetchImpl: Fetch = fetch): Promise<Spoken> {
  let lastError: unknown = new Error('No speech engine is set up.');
  for (const engine of [
    keys.gemini ? () => geminiSpeak(text, keys.gemini!, fetchImpl) : null,
    keys.openai ? () => openaiSpeak(text, keys.openai!, fetchImpl) : null,
  ]) {
    if (!engine) continue;
    try {
      return await engine();
    } catch (err) {
      console.error('[speech] speaking failed, trying the other engine:', err);
      lastError = err;
    }
  }
  throw lastError;
}

// ── Speaking as a stream (a piece of a reply at a time, played back to back by the device) ──

type Emit = (pcm: Uint8Array) => void;

/** The base64 audio in one streamed event, wherever this API version puts it. */
function audioIn(evt: Record<string, unknown>): string | null {
  const delta = evt.delta as { type?: string; data?: string } | undefined;
  if (delta?.type === 'audio' && typeof delta.data === 'string') return delta.data;
  const content = (evt.content ?? (evt.step as { content?: unknown } | undefined)?.content) as Array<{ type?: string; data?: string }> | undefined;
  const audio = Array.isArray(content) ? content.find(c => c.type === 'audio' && typeof c.data === 'string') : undefined;
  return audio?.data ?? null;
}

async function geminiSpeakStream(text: string, key: EngineKey, emit: Emit, signal: AbortSignal, fetchImpl: Fetch): Promise<Paid> {
  const res = await fetchImpl(GEMINI_INTERACTIONS, {
    method: 'POST',
    headers: { 'x-goog-api-key': key.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEMINI_TTS_MODEL,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: SPEECH_STYLE }] }] }],
      response_format: { type: 'audio', mime_type: 'audio/l16', sample_rate: 24_000 },
      generation_config: { speech_config: [{ voice: GEMINI_VOICE }] },
      stream: true,
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Google speech ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  let bytes = 0;
  let usage: { input: number; output: number } | null = null;
  let first = true;
  const send = (b64: string) => {
    let pcm: Uint8Array = Buffer.from(b64, 'base64');
    // A WAV header (if the format was ignored) is not sound.
    if (first && pcm.length > 44 && Buffer.from(pcm.subarray(0, 4)).toString() === 'RIFF') pcm = pcm.subarray(44);
    first = false;
    if (pcm.length) { emit(pcm); bytes += pcm.length; }
  };
  const handle = (json: string) => {
    if (!json || json === '[DONE]') return;
    try {
      const evt = JSON.parse(json) as Record<string, unknown>;
      const audio = audioIn(evt);
      if (audio) send(audio);
      for (const s of Array.isArray(evt.steps) ? evt.steps as Array<Record<string, unknown>> : []) {
        const a = audioIn(s);
        if (a) send(a);
      }
      usage = usageOf(evt) ?? usageOf((evt.interaction ?? {}) as Record<string, unknown>) ?? usage;
    } catch { /* not an event */ }
  };
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    // Answered in one piece after all.
    handle(await res.text());
  } else {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) handle(line.slice(5).trim());
      }
    }
    if (buffer.trim().startsWith('data:')) handle(buffer.trim().slice(5).trim());
  }
  if (bytes === 0) throw new Error('Google speech stream had no audio.');
  const prices = geminiTtsUsdPerM();
  const used = usage as { input: number; output: number } | null;
  const costUsd = used
    ? (used.input * prices.textIn + used.output * prices.audioOut) / 1_000_000
    : ((bytes / 48_000) * 25 * prices.audioOut + (text.length / 4) * prices.textIn) / 1_000_000;
  return { costUsd, own: key.own, engine: GEMINI_TTS_MODEL };
}

async function openaiSpeakStream(text: string, key: EngineKey, emit: Emit, signal: AbortSignal, fetchImpl: Fetch): Promise<Paid> {
  const res = await fetchImpl('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json' },
    // pcm: 24 kHz, 16-bit little-endian mono — the same as Google's stream.
    body: JSON.stringify({ model: 'tts-1', voice: 'nova', input: text, response_format: 'pcm' }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`OpenAI speech ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length) emit(value);
  }
  return { costUsd: text.length * TTS_USD_PER_CHAR, own: key.own, engine: 'tts-1' };
}

/**
 * A piece of a reply spoken as a stream of raw 16-bit PCM (24 kHz mono), sent on as it is made. Google
 * first; OpenAI if Google fails before any sound was sent. `paid` gets the real cost once it is known.
 */
export function streamSpeech(text: string, keys: EngineKeys, paid: (p: Paid) => Promise<void> | void, fetchImpl: Fetch = fetch): ReadableStream<Uint8Array> {
  const abort = new AbortController();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = 0;
      const emit: Emit = pcm => { sent += pcm.length; controller.enqueue(pcm); };
      for (const engine of [
        keys.gemini ? () => geminiSpeakStream(text, keys.gemini!, emit, abort.signal, fetchImpl) : null,
        keys.openai ? () => openaiSpeakStream(text, keys.openai!, emit, abort.signal, fetchImpl) : null,
      ]) {
        if (!engine) continue;
        try {
          await paid(await engine());
          break;
        } catch (err) {
          if (abort.signal.aborted) break;
          console.error('[speech] streaming failed:', err);
          if (sent > 0) break; // part was already heard: don't start again in another voice
        }
      }
      try { controller.close(); } catch { /* cancelled */ }
    },
    cancel() { abort.abort(); },
  });
}

// ── What gets spoken ──

const FIRST_PART = 220;
const PART = 450;
const MAX_PARTS = 12;

/** A reply as it should sound: no Markdown, links, code or emoji; tables read row by row. */
export function speakableText(text: string): string {
  return text
    .replace(/<action>[\s\S]*?<\/action>/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map(line => {
      const t = line.trim();
      if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(t)) return ''; // a table's ruling
      if (/^-{3,}$|^\*{3,}$/.test(t)) return '';
      const row = t.startsWith('|') ? t.replace(/^\||\|$/g, '').split('|').map(c => c.trim()).filter(Boolean).join(', ') : t;
      return row
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^([-*+•]|\d+[.)])\s+/, '');
    })
    .map(line => line
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\p{Extended_Pictographic}️?/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim())
    .filter(Boolean)
    // Each line its own sentence, so lists and table rows get a pause.
    .map(line => (/[.!?।॥:;,]$/.test(line) ? line : `${line}.`))
    .join(' ')
    .trim();
}

function sentences(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: 'sentence' }) => { segment: (t: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) return [...new Segmenter('und', { granularity: 'sentence' }).segment(text)].map(s => s.segment.trim()).filter(Boolean);
  return text.split(/(?<=[.!?।॥])\s+/).map(s => s.trim()).filter(Boolean);
}

/** Splits a long sentence at commas, then spaces, so no piece is over `max`. */
function pieces(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf(' '));
    const at = cut > max / 3 ? cut + 1 : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** A reply in parts to speak one after another: a short first part so speech starts quickly. */
export function speechParts(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const piece of sentences(speakableText(text)).flatMap(s => pieces(s, PART))) {
    const limit = parts.length === 0 ? FIRST_PART : PART;
    if (current && current.length + 1 + piece.length > limit) {
      parts.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts.slice(0, MAX_PARTS);
}
