// Speaking a reply smoothly, shared by the website and the app: the reply is cut into sentences as it is
// written, each sentence's voice streams in as raw audio (16-bit mono PCM, 24 kHz) and is played back to
// back with its silences trimmed — so speech starts within a moment and has no gaps.
// No imports: the app bundles this file as it is. Each platform supplies how audio is fetched and played.

export const SPEECH_SAMPLE_RATE = 24_000;

// ── Cutting a reply into pieces to speak ──

/** Sentence ends: Latin, Devanagari (।॥), CJK (。！？) — followed by space (not a list's "1. "). */
const SENTENCE_END = /(?<![0-9])[.!?।॥](?=\s)|[。！？]/g;
const FIRST_MIN = 4;
const GROUP_MIN = 140;
const FORCE_CUT = 240;
const MAX_PIECE = 450;

/** A long paragraph → pieces of whole sentences (or, without sentence ends, at spaces), each ≤ MAX_PIECE. */
function splitLong(piece: string): string[] {
  if (piece.length <= MAX_PIECE) return [piece];
  const out: string[] = [];
  let current = '';
  for (const sentence of piece.split(/(?<=[.!?।॥。！？])\s+/)) {
    if (current && current.length + 1 + sentence.length > MAX_PIECE) { out.push(current); current = sentence; }
    else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) out.push(current);
  return out.flatMap(p => {
    const parts: string[] = [];
    let rest = p;
    while (rest.length > MAX_PIECE) {
      const space = rest.lastIndexOf(' ', MAX_PIECE);
      const at = space > MAX_PIECE / 2 ? space : MAX_PIECE;
      parts.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  });
}

/**
 * Cuts the reply into pieces as it streams in: the first finished sentence at once (speech starts
 * quickly), then groups of sentences. Code blocks are not spoken.
 */
export class SpeechSegmenter {
  private used = 0;
  private sent = 0;

  /** The reply so far → pieces now ready to speak. */
  update(text: string): string[] {
    return this.take(text, false);
  }

  /** The finished reply → everything not yet spoken. */
  finish(text: string): string[] {
    return this.take(text, true);
  }

  private take(text: string, final: boolean): string[] {
    const pieces: string[] = [];
    let start = this.used;
    let i = start;
    let inCode = (text.slice(0, start).match(/```/g)?.length ?? 0) % 2 === 1;
    const cut = (end: number) => {
      const piece = text.slice(start, end).trim();
      start = end;
      if (piece && !inCode) {
        pieces.push(...splitLong(piece));
        this.sent++;
      }
    };
    while (i < text.length) {
      const nl = text.indexOf('\n', i);
      const lineEnd = nl === -1 ? text.length : nl;
      const line = text.slice(i, lineEnd);
      if (line.trim().startsWith('```')) {
        cut(i);
        inCode = !inCode;
        start = nl === -1 ? text.length : nl + 1;
        i = start;
        if (nl === -1) break;
        continue;
      }
      if (nl === -1 && !final) {
        // The line is still being written: cut at a finished sentence, or a long run at a space.
        let last = -1;
        for (const m of line.matchAll(SENTENCE_END)) last = (m.index ?? 0) + m[0].length;
        if (last > 0) {
          const end = i + last;
          if (end - start >= (this.sent === 0 ? FIRST_MIN : GROUP_MIN)) cut(end);
        } else if (lineEnd - start > FORCE_CUT && !inCode) {
          const space = text.lastIndexOf(' ', start + FORCE_CUT - 40);
          if (space > start) cut(space);
        }
        break;
      }
      // A finished line (or the end of the finished reply).
      const end = nl === -1 ? text.length : nl + 1;
      if (end - start >= (this.sent === 0 ? FIRST_MIN : GROUP_MIN) || final || inCode) cut(end);
      i = end;
    }
    if (final) cut(text.length);
    this.used = start;
    return pieces;
  }
}

// ── Audio ──

/** 16-bit little-endian PCM bytes → samples (−1…1). A trailing odd byte is carried to the next chunk. */
export function pcm16ToFloat(bytes: Uint8Array, carry: number | null): { samples: Float32Array; carry: number | null } {
  let data = bytes;
  if (carry !== null) {
    data = new Uint8Array(bytes.length + 1);
    data[0] = carry;
    data.set(bytes, 1);
  }
  const n = Math.floor(data.length / 2);
  const samples = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let v = data[2 * k] | (data[2 * k + 1] << 8);
    if (v >= 0x8000) v -= 0x10000;
    samples[k] = v / 0x8000;
  }
  return { samples, carry: data.length % 2 === 1 ? data[data.length - 1] : null };
}

const QUIET = 0.006;
/** Quiet after the last sound is held back (it may be the clip's end), up to this much. */
const MAX_QUIET_HOLD = Math.round(1.2 * SPEECH_SAMPLE_RATE);
const KEEP_LEAD = Math.round(0.03 * SPEECH_SAMPLE_RATE);
const KEEP_TAIL = Math.round(0.08 * SPEECH_SAMPLE_RATE);

/** Trims one clip's leading and trailing silence as it streams (the end is held back until it is known). */
export class ClipShaper {
  private started = false;
  private held = new Float32Array(0);

  /** New samples → samples ready to play. */
  push(samples: Float32Array): Float32Array {
    let s = samples;
    if (!this.started) {
      let k = 0;
      while (k < s.length && Math.abs(s[k]) < QUIET) k++;
      if (k === s.length) return new Float32Array(0);
      this.started = true;
      s = s.subarray(Math.max(0, k - KEEP_LEAD));
    }
    const all = concat(this.held, s);
    let lastSound = all.length;
    while (lastSound > 0 && Math.abs(all[lastSound - 1]) < QUIET) lastSound--;
    const holdFrom = all.length - lastSound > MAX_QUIET_HOLD ? all.length - MAX_QUIET_HOLD : lastSound;
    this.held = all.slice(holdFrom);
    return all.subarray(0, holdFrom);
  }

  /** The clip has ended → its held end, without the trailing silence. */
  end(): Float32Array {
    let k = this.held.length;
    while (k > 0 && Math.abs(this.held[k - 1]) < QUIET) k--;
    const out = this.held.slice(0, Math.min(this.held.length, k + KEEP_TAIL));
    this.held = new Float32Array(0);
    return out;
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

// ── Speaking a reply ──

/** Where the voice for a piece of text comes from: the platform's streaming request to /api/tts/stream. */
export type SpeechStream = (text: string, signal: AbortSignal) => Promise<AsyncIterable<Uint8Array>>;

/** Where samples are played: queued back to back on the platform's audio output. */
export interface SpeechSink {
  /** Queues samples (mono, 24 kHz) right after what is already queued. */
  play(samples: Float32Array): void;
  /** Queues a moment of silence. */
  rest(seconds: number): void;
  /** Seconds until everything queued has played. */
  remaining(): number;
  /** Stops at once and forgets the queue. */
  clear(): void;
}

export type SpeechEnd = 'finished' | 'stopped' | 'failed';

/** A natural breath between sentences (their own silences are trimmed). */
const BETWEEN = 0.16;
const AHEAD = 2;

interface Piece { text: string; chunks: Uint8Array[]; done: boolean; failed: boolean; wake: (() => void) | null; started: boolean }

/**
 * Speaks one reply. Feed it the text as it is written (`update`), then `finish`; `done` resolves when
 * the last word has played, or when it was stopped or failed.
 */
export class ReplyVoice {
  readonly done: Promise<SpeechEnd>;
  private resolve!: (end: SpeechEnd) => void;
  private segmenter = new SpeechSegmenter();
  private pieces: Piece[] = [];
  private finished = false;
  private stopped = false;
  private abort = new AbortController();
  private playing = false;
  private spoken = 0;

  constructor(private stream: SpeechStream, private sink: SpeechSink) {
    this.done = new Promise(r => { this.resolve = r; });
  }

  update(text: string): void {
    if (this.stopped || this.finished) return;
    this.add(this.segmenter.update(text));
  }

  finish(text: string): void {
    if (this.stopped || this.finished) return;
    this.add(this.segmenter.finish(text));
    this.finished = true;
    this.kick();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    this.sink.clear();
    for (const p of this.pieces) p.wake?.();
    this.resolve('stopped');
  }

  private add(texts: string[]): void {
    for (const text of texts) this.pieces.push({ text, chunks: [], done: false, failed: false, wake: null, started: false });
    this.kick();
  }

  /** Starts fetching the next pieces (a couple ahead) and the player. */
  private kick(): void {
    const playingAt = this.spoken;
    for (let k = playingAt; k < Math.min(this.pieces.length, playingAt + AHEAD); k++) {
      const p = this.pieces[k];
      if (!p.started) { p.started = true; void this.fetch(p); }
    }
    if (!this.playing) void this.play();
  }

  private async fetch(p: Piece): Promise<void> {
    try {
      for await (const chunk of await this.stream(p.text, this.abort.signal)) {
        p.chunks.push(chunk);
        p.wake?.();
      }
    } catch {
      p.failed = true;
    }
    p.done = true;
    p.wake?.();
  }

  private async play(): Promise<void> {
    this.playing = true;
    let heardAny = false;
    while (!this.stopped) {
      const p = this.pieces[this.spoken];
      if (!p) {
        if (!this.finished) { await new Promise<void>(r => setTimeout(r, 60)); continue; }
        break;
      }
      const shaper = new ClipShaper();
      let carry: number | null = null;
      let read = 0;
      for (;;) {
        while (read < p.chunks.length) {
          const { samples, carry: next } = pcm16ToFloat(p.chunks[read++], carry);
          carry = next;
          const ready = shaper.push(samples);
          if (ready.length) { this.sink.play(ready); heardAny = true; }
        }
        if (p.done || this.stopped) break;
        await new Promise<void>(r => { p.wake = r; });
        p.wake = null;
      }
      if (this.stopped) return;
      const tail = shaper.end();
      if (tail.length) { this.sink.play(tail); heardAny = true; }
      this.sink.rest(BETWEEN);
      if (p.failed && !heardAny && this.spoken === 0) {
        this.stopped = true;
        this.sink.clear();
        this.resolve('failed');
        return;
      }
      this.spoken++;
      this.kick();
    }
    if (this.stopped) return;
    // Everything is queued: wait for it to finish playing.
    while (!this.stopped && this.sink.remaining() > 0.05) await new Promise<void>(r => setTimeout(r, 80));
    if (!this.stopped) {
      this.stopped = true;
      // Nothing to say (a reply that is only a card) is not a failure.
      this.resolve(heardAny || this.pieces.length === 0 ? 'finished' : 'failed');
    }
  }
}
