import { describe, expect, it, vi } from 'vitest';

import { newVad, vadStep, VAD, languageRule, type VadState } from '@/lib/contracts';
import { speakableText, speechParts, streamSpeech, synthesizeSpeech, transcribeSpeech, wavFromPcm } from '../speech';

/** Feeds a level for a while, 100 ms at a time; returns the state and the first event. */
function feed(state: VadState, db: number, ms: number) {
  let s = state;
  for (let t = 0; t < ms; t += 100) {
    const r = vadStep(s, db, 100);
    s = r.state;
    if (r.event !== 'none') return { state: s, event: r.event, at: t };
  }
  return { state: s, event: 'none' as const, at: ms };
}

describe('speech detection', () => {
  const room = -55;

  it('ends the turn after real speech and a pause', () => {
    let r = feed(newVad(), room, 400);
    r = feed(r.state, -25, 1500);
    expect(r.state.heard).toBe(true);
    r = feed(r.state, room, 3000);
    expect(r.event).toBe('end');
    expect(r.at).toBeGreaterThanOrEqual(VAD.pauseMs - 100);
  });

  it('never counts silence or a steady fan as speech', () => {
    expect(feed(newVad(), room, 25_000).event).toBe('nothing');
    expect(feed(newVad(), -38, 25_000).event).toBe('nothing');
  });

  it('ignores clicks and knocks that are too short to be words', () => {
    let s = feed(newVad(), room, 400).state;
    for (let i = 0; i < 30; i++) {
      s = feed(s, -15, 100).state; // a 0.1 s knock
      s = feed(s, room, 700).state;
    }
    expect(s.heard).toBe(false);
  });

  it('forgets short bursts that never added up to speech', () => {
    let s = feed(newVad(), room, 400).state;
    s = feed(s, -25, 300).state;
    expect(s.voicedMs).toBeGreaterThan(0);
    s = feed(s, room, VAD.forgetMs + 200).state;
    expect(s.voicedMs).toBe(0);
  });

  it('works in a noisy room: speech must stand out from the noise', () => {
    const noisy = -35;
    let r = feed(newVad(), noisy, 400);
    r = feed(r.state, -30, 3000); // a little louder than the room: still noise
    expect(r.state.heard).toBe(false);
    r = feed(r.state, -15, 1200);
    expect(r.state.heard).toBe(true);
  });

  it('does not take a short gap between words as the end', () => {
    let r = feed(newVad(), room, 400);
    r = feed(r.state, -25, 1000);
    r = feed(r.state, room, 600);
    expect(r.event).toBe('none');
    r = feed(r.state, -25, 800);
    expect(r.event).toBe('none');
  });
});

describe('language rule', () => {
  it('tells the assistant the chosen language, and nothing for automatic', () => {
    expect(languageRule('ml')).toContain('Malayalam');
    expect(languageRule('ml')).toContain('own script');
    expect(languageRule(null)).toBe('');
    expect(languageRule('xx')).toBe('');
  });
});

describe('what gets spoken', () => {
  it('reads Markdown, tables and links as plain speech', () => {
    const said = speakableText([
      '## Your apps',
      '| App | Status |',
      '|---|---|',
      '| **Gmail** | Connected |',
      '- See [the guide](https://x.io/guide) or https://x.io 😄',
      '<action>{"type":"run"}</action>',
    ].join('\n'));
    expect(said).toBe('Your apps. App, Status. Gmail, Connected. See the guide or.');
  });

  it('splits long replies with a short first part, and caps them', () => {
    const long = Array.from({ length: 80 }, (_, i) => `This is sentence number ${i} of a long answer.`).join(' ');
    const parts = speechParts(long);
    expect(parts[0].length).toBeLessThanOrEqual(220);
    expect(parts.slice(1).every(p => p.length <= 450)).toBe(true);
    expect(parts.length).toBeLessThanOrEqual(12);
    expect(speechParts('Done.')).toEqual(['Done.']);
  });
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const audio = new Blob([new Uint8Array(100)], { type: 'audio/m4a' });
const keys = { openai: { key: 'o', own: false }, gemini: { key: 'g', own: false } };

describe('hearing', () => {
  it('sends Malayalam to Google with the language and English, and bills its usage', async () => {
    const fetchImpl = vi.fn(async () => ok({ output_text: 'നമസ്കാരം', usage: { total_input_tokens: 250, total_output_tokens: 10 } }));
    const heard = await transcribeSpeech(audio, { fileName: 'voice.m4a', mimeType: 'audio/m4a', language: 'ml', seconds: 10 }, keys, fetchImpl as never);
    expect(heard.text).toBe('നമസ്കാരം');
    expect(heard.engine).toBe('gemini-3.5-transcribe');
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.generation_config.transcription_config.language_codes).toEqual(['ml-IN', 'en-IN']);
    expect(body.input[0].mime_type).toBe('audio/m4a');
    expect(heard.costUsd).toBeCloseTo((250 * 2 + 10 * 12) / 1e6, 10);
  });

  it('sends Tamil and unset languages to OpenAI, with language hints', async () => {
    const fetchImpl = vi.fn(async () => ok({ text: 'வணக்கம்', languages: [{ code: 'ta' }] }));
    const heard = await transcribeSpeech(audio, { fileName: 'voice.m4a', mimeType: 'audio/m4a', language: 'ta', seconds: 60 }, keys, fetchImpl as never);
    expect(heard.engine).toBe('gpt-transcribe');
    expect(heard.language).toBe('ta');
    const form = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.getAll('languages[]')).toEqual(['ta', 'en']);
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(heard.costUsd).toBeCloseTo(0.0045, 10);
  });

  it('falls back to the other engine when one fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(ok({ text: 'hello', languages: [{ code: 'en' }] }));
    const heard = await transcribeSpeech(audio, { fileName: 'voice.m4a', mimeType: 'audio/m4a', language: 'hi', seconds: 5 }, keys, fetchImpl as never);
    expect(heard.engine).toBe('gpt-transcribe');
    expect(heard.text).toBe('hello');
  });
});

describe('speaking', () => {
  it('uses Gemini TTS and wraps raw PCM as WAV', async () => {
    const pcm = Buffer.alloc(48_000).toString('base64');
    const fetchImpl = vi.fn(async () => ok({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: pcm, mime_type: 'audio/l16' }] }], usage: { total_input_tokens: 20, total_output_tokens: 25 } }));
    const spoken = await synthesizeSpeech('Hello', keys, fetchImpl as never);
    expect(spoken.engine).toBe('gemini-3.8-flash-tts');
    expect(spoken.mimeType).toBe('audio/wav');
    expect(Buffer.from(spoken.audio.slice(0, 4)).toString()).toBe('RIFF');
    expect(spoken.audio.length).toBe(48_044);
  });

  it('falls back to OpenAI when Gemini fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(wavFromPcm(new Uint8Array(10))), { status: 200 }));
    const spoken = await synthesizeSpeech('Hello', keys, fetchImpl as never);
    expect(spoken.engine).toBe('tts-1');
    expect(spoken.costUsd).toBeCloseTo(5 * 15 / 1e6, 12);
  });
});

describe('speaking as a stream', () => {
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const out: number[] = [];
    const reader = stream.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; out.push(...value); }
    return out;
  };
  const sse = (events: unknown[]) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

  it('passes Google’s streamed audio on as it comes, and bills its usage', async () => {
    const chunk = (bytes: number[]) => ({ event_type: 'step.delta', delta: { type: 'audio', data: Buffer.from(bytes).toString('base64') } });
    const fetchImpl = vi.fn(async () => sse([chunk([1, 2, 3, 4]), chunk([5, 6]), { event_type: 'interaction.complete', interaction: { usage: { total_input_tokens: 10, total_output_tokens: 50 } } }]));
    const paid = vi.fn();
    expect(await read(streamSpeech('Hello there.', keys, paid, fetchImpl as never))).toEqual([1, 2, 3, 4, 5, 6]);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.stream).toBe(true);
    expect(body.response_format).toMatchObject({ mime_type: 'audio/l16', sample_rate: 24000 });
    expect(paid.mock.calls[0][0]).toMatchObject({ engine: 'gemini-3.8-flash-tts', own: false });
    expect(paid.mock.calls[0][0].costUsd).toBeCloseTo((10 * 0.5 + 50 * 9) / 1e6, 10);
  });

  it('uses OpenAI’s voice when Google fails before any sound', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('quota', { status: 429 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9, 9]), { status: 200 }));
    const paid = vi.fn();
    expect(await read(streamSpeech('Hi.', keys, paid, fetchImpl as never))).toEqual([9, 9]);
    expect(paid.mock.calls[0][0].engine).toBe('tts-1');
    const body = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(body.response_format).toBe('pcm');
  });
});
