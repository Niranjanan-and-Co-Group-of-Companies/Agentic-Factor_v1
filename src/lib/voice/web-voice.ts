// Voice in the browser: one audio system for the page (unlocked by the click that starts voice, as Safari
// requires), the microphone one turn at a time (measured by the speech detector shared with the app), and
// replies spoken smoothly — streamed sentence by sentence and played back to back (@/lib/contracts/speech).
// Browser-only.

import {
  loudness, newVad, ReplyVoice, SPEECH_SAMPLE_RATE, vadStep,
  type SpeechSink, type SpeechStream, type TranscriptionResult, type VadEvent, type VadState,
} from '@/lib/contracts';

const TICK_MS = 100;

let shared: AudioContext | null = null;

/** The page's audio system. Call it inside a click first (Safari only lets sound start from one). */
export function unlockAudio(): AudioContext {
  shared ??= new AudioContext();
  if (shared.state === 'suspended') void shared.resume().catch(() => {});
  return shared;
}

export interface Recording { blob: Blob; voicedMs: number; durationMs: number }

/** The microphone for one turn: records, and follows the level through the speech detector. */
export class MicTurn {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private vad: VadState = newVad();

  /**
   * Opens the microphone and records; `onTick` gets the level (0–1) and the detector's event. Speaking
   * into the message box passes a longer pause and time limit.
   */
  async start(onTick: (level: number, event: VadEvent) => void, limits?: { pauseMs?: number; maxMs?: number }): Promise<void> {
    const context = unlockAudio();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.recorder = new MediaRecorder(this.stream);
    this.chunks = [];
    this.recorder.ondataavailable = e => { if (e.data.size > 0) this.chunks.push(e.data); };
    this.recorder.start(250);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    this.source = context.createMediaStreamSource(this.stream);
    this.source.connect(analyser);
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
      const r = vadStep(this.vad, db, now - last, limits);
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
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (recorder && recorder.state !== 'inactive') {
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      recorder.stop();
      await Promise.race([stopped, new Promise(r => setTimeout(r, 2000))]);
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
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
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

// ── Speaking ──

/** The voice for a piece of text, as it is made (raw 16-bit PCM, 24 kHz). */
const fetchSpeech: SpeechStream = async (text, signal) => {
  const res = await fetch('/api/tts/stream', {
    method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (res.status === 204 || !res.body) return (async function* () { /* nothing to say */ })();
  if (!res.ok) throw new Error(`Read aloud failed (${res.status})`);
  const reader = res.body.getReader();
  return (async function* () {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value?.length) yield value;
    }
  })();
};

/** Plays samples back to back on the page's audio system. */
class PageSink implements SpeechSink {
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  constructor(private context: AudioContext, private onSound: () => void) {}

  play(samples: Float32Array): void {
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, samples.length, SPEECH_SAMPLE_RATE);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const at = Math.max(this.next, ctx.currentTime + 0.05);
    source.start(at);
    this.next = at + buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
    this.onSound();
  }

  rest(seconds: number): void { this.next = Math.max(this.next, this.context.currentTime) + seconds; }
  remaining(): number { return Math.max(0, this.next - this.context.currentTime); }
  clear(): void {
    for (const s of this.sources) { try { s.stop(); } catch { /* already ended */ } }
    this.sources.clear();
    this.next = 0;
  }
}

/** Speaks one reply on the page: feed it the text as it is written (`update`), then `finish`. */
export function replyVoice(onSound: () => void): ReplyVoice {
  return new ReplyVoice(fetchSpeech, new PageSink(unlockAudio(), onSound));
}
