// Voice in the browser: the microphone (one turn at a time, measured by the same speech detector as the
// app, @/lib/contracts/voice) and replies read aloud part by part. Browser-only.

import { loudness, newVad, vadStep, type TranscriptionResult, type VadEvent, type VadState } from '@/lib/contracts';

const TICK_MS = 100;

export interface Recording { blob: Blob; voicedMs: number; durationMs: number }

/** The microphone for one turn: records, and follows the level through the speech detector. */
export class MicTurn {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private vad: VadState = newVad();

  /** Opens the microphone and records; `onTick` gets the level (0–1) and the detector's event. */
  async start(onTick: (level: number, event: VadEvent) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.recorder = new MediaRecorder(this.stream);
    this.chunks = [];
    this.recorder.ondataavailable = e => { if (e.data.size > 0) this.chunks.push(e.data); };
    this.recorder.start(250);
    this.context = new AudioContext();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 2048;
    this.context.createMediaStreamSource(this.stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    this.vad = newVad();
    this.startedAt = performance.now();
    let last = this.startedAt;
    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      const db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-8);
      const now = performance.now();
      const r = vadStep(this.vad, db, now - last);
      last = now;
      this.vad = r.state;
      onTick(loudness(db), r.event);
    }, TICK_MS);
  }

  get seconds(): number { return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0; }

  /** Stops, and gives the recording with how much real voice was in it (null when nothing was recorded). */
  async stop(): Promise<Recording | null> {
    const recorder = this.recorder;
    const measured = { voicedMs: this.vad.voicedMs, durationMs: performance.now() - this.startedAt };
    if (recorder && recorder.state !== 'inactive') {
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      recorder.stop();
      await stopped;
    }
    const type = recorder?.mimeType || 'audio/webm';
    this.release();
    return this.chunks.length ? { blob: new Blob(this.chunks, { type }), ...measured } : null;
  }

  /** Stops and throws the recording away. */
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.chunks = [];
    this.release();
  }

  private release(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}

/** A recording's words (the server skips recordings with too little real voice: `noSpeech`). */
export async function transcribeRecording(rec: Recording): Promise<TranscriptionResult> {
  const form = new FormData();
  // The type (webm from Chrome, mp4 from Safari) names the file on the server.
  form.append('audio', rec.blob, 'recording');
  form.append('voicedMs', String(Math.round(rec.voicedMs)));
  form.append('durationMs', String(Math.round(rec.durationMs)));
  const res = await fetch('/api/whisper/transcribe', { method: 'POST', body: form, credentials: 'include' });
  const data = await res.json().catch(() => ({})) as Partial<TranscriptionResult> & { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Couldn’t turn that into text. Please try again.');
  return { text: (data.text ?? '').trim(), language: data.language ?? null, ...(data.noSpeech ? { noSpeech: true } : {}) };
}

export type SpeechEnd = 'finished' | 'stopped' | 'failed';
export type SpeechSource = { messageId: string } | { text: string };

// A moment of silence: playing it during a click lets the page play replies later (Safari's rule).
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

/** Reads replies aloud through one audio element, part by part, fetching the next part while one plays. */
export class ReplySpeaker {
  private audio: HTMLAudioElement | null = null;
  private run = 0;
  private wake: (() => void) | null = null;
  /** Parts of saved replies already fetched (messageId:part → object URL), so replaying is free. */
  private cache = new Map<string, { url: string; parts: number }>();

  private element(): HTMLAudioElement {
    this.audio ??= new Audio();
    return this.audio;
  }

  /** Call inside a click (Speak, Voice mode): lets later replies play without one. */
  unlock(): void {
    const a = this.element();
    if (a.src && !a.src.startsWith('data:')) return;
    a.src = SILENCE;
    void a.play().catch(() => {});
  }

  stop(): void {
    this.run++;
    this.audio?.pause();
    this.wake?.();
    this.wake = null;
  }

  private async part(source: SpeechSource, index: number): Promise<{ url: string; parts: number }> {
    const key = 'messageId' in source ? `${source.messageId}:${index}` : null;
    const hit = key ? this.cache.get(key) : undefined;
    if (hit) return hit;
    const res = 'messageId' in source
      ? await fetch(`/api/tts?messageId=${encodeURIComponent(source.messageId)}&part=${index}`, { credentials: 'include' })
      : await fetch('/api/tts', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: source.text, part: index }) });
    if (!res.ok) throw new Error(`Read aloud failed (${res.status})`);
    const got = { url: URL.createObjectURL(await res.blob()), parts: Number(res.headers.get('X-Speech-Parts') ?? '1') || 1 };
    if (key) this.cache.set(key, got);
    return got;
  }

  /** Speaks a saved reply (by id) or any text, stopping anything playing; resolves when it ends. */
  async speak(source: SpeechSource): Promise<SpeechEnd> {
    this.stop();
    const mine = ++this.run;
    try {
      const first = await this.part(source, 0);
      let next = first.parts > 1 ? this.part(source, 1).catch(() => null) : null;
      for (let i = 0; i < first.parts; i++) {
        const current = i === 0 ? first : await next;
        if (mine !== this.run) return 'stopped';
        if (!current) return 'failed';
        if (i > 0 && i + 1 < first.parts) next = this.part(source, i + 1).catch(() => null);
        const a = this.element();
        a.src = current.url;
        await new Promise<void>(resolve => {
          this.wake = resolve;
          a.onended = () => resolve();
          a.onerror = () => resolve();
          a.play().catch(() => resolve());
        });
        if (!('messageId' in source)) URL.revokeObjectURL(current.url);
        if (mine !== this.run) return 'stopped';
      }
      return 'finished';
    } catch {
      return mine === this.run ? 'failed' : 'stopped';
    }
  }
}
