import { describe, expect, it } from 'vitest';

import { ClipShaper, pcm16ToFloat, ReplyVoice, SpeechSegmenter, SPEECH_SAMPLE_RATE, type SpeechSink } from '@/lib/contracts';

/** Feeds a reply in small slices, as it streams; returns every piece in order. */
function streamPieces(reply: string, step = 7): string[] {
  const seg = new SpeechSegmenter();
  const out: string[] = [];
  for (let n = step; n < reply.length; n += step) out.push(...seg.update(reply.slice(0, n)));
  out.push(...seg.finish(reply));
  return out;
}

describe('cutting a reply into pieces', () => {
  it('speaks the first sentence at once, then groups, and loses nothing', () => {
    const reply = 'Sure, I can do that. I will read your inbox first and then list the unpaid invoices for you. After that I will put them in a sheet. Finally I will email the summary to you.';
    const pieces = streamPieces(reply);
    expect(pieces[0]).toBe('Sure, I can do that.');
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(reply);
    expect(pieces.length).toBeGreaterThan(1);
  });

  it('works for Malayalam, Hindi and Chinese sentence ends', () => {
    expect(streamPieces('തീർച്ചയായും, ചെയ്യാം. ഇനി എന്ത് വേണം?')[0]).toBe('തീർച്ചയായും, ചെയ്യാം.');
    expect(streamPieces('ज़रूर, मैं यह कर दूँगा। आगे क्या करना है?')[0]).toBe('ज़रूर, मैं यह कर दूँगा।');
    expect(streamPieces('好的，我来处理。还有什么需要吗？')[0]).toBe('好的，我来处理。');
  });

  it('skips code blocks and keeps list lines', () => {
    const reply = 'Here is the plan:\n- Read the inbox\n- Make the sheet\n```\nconst x = 1;\n```\nDone.';
    const pieces = streamPieces(reply, 5).join('\n');
    expect(pieces).toContain('Read the inbox');
    expect(pieces).toContain('Done.');
    expect(pieces).not.toContain('const x');
  });

  it('cuts long text without sentence ends (Thai) at spaces, and never makes a piece too long', () => {
    const thai = Array.from({ length: 80 }, () => 'สวัสดีครับ').join(' ');
    const pieces = streamPieces(thai, 11);
    expect(pieces.every(p => p.length <= 450)).toBe(true);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(thai);
    const longParagraph = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    expect(new SpeechSegmenter().finish(longParagraph).every(p => p.length <= 450)).toBe(true);
  });
});

describe('audio', () => {
  it('turns 16-bit PCM into samples, carrying a split byte', () => {
    const bytes = new Uint8Array([0x00, 0x40, 0x00, 0xc0, 0xff]); // 0.5, -0.5, then half a sample
    const a = pcm16ToFloat(bytes, null);
    expect(Array.from(a.samples)).toEqual([0.5, -0.5]);
    expect(a.carry).toBe(0xff);
    const b = pcm16ToFloat(new Uint8Array([0x7f]), a.carry);
    expect(b.samples[0]).toBeCloseTo(32767 / 32768, 5);
  });

  it('trims a clip’s silent start and end', () => {
    const shaper = new ClipShaper();
    const silence = new Float32Array(SPEECH_SAMPLE_RATE / 2);
    const voice = new Float32Array(SPEECH_SAMPLE_RATE).fill(0.3);
    const out = [shaper.push(silence), shaper.push(voice), shaper.push(silence), shaper.end()];
    const total = out.reduce((n, a) => n + a.length, 0);
    // About the voice itself, plus a few hundredths of a second either side — not the full 1 s of silence.
    expect(total).toBeGreaterThan(SPEECH_SAMPLE_RATE);
    expect(total).toBeLessThan(SPEECH_SAMPLE_RATE * 1.15);
  });
});

/** A sink that "plays" instantly and records what it got. */
function fakeSink() {
  const played: number[] = [];
  const sink: SpeechSink & { played: number[]; rests: number } = {
    played, rests: 0,
    play: s => { played.push(s.length); },
    rest: () => { sink.rests++; },
    remaining: () => 0,
    clear: () => { played.length = 0; },
  };
  return sink;
}

const pcm = (seconds: number) => {
  const n = Math.round(seconds * SPEECH_SAMPLE_RATE);
  const bytes = new Uint8Array(n * 2);
  for (let k = 0; k < n; k++) { bytes[2 * k] = 0x00; bytes[2 * k + 1] = 0x20; } // 0.25
  return bytes;
};

describe('speaking a reply', () => {
  it('speaks every piece in order while the reply is still being written, then finishes', async () => {
    const asked: string[] = [];
    const voice = new ReplyVoice(async text => {
      asked.push(text);
      return (async function* () { yield pcm(0.2); yield pcm(0.2); })();
    }, fakeSink());
    voice.update('Hello there. ');
    voice.update('Hello there. I made the sheet with all twelve unpaid invoices and their amounts, as you asked me to do earlier today.');
    voice.finish('Hello there. I made the sheet with all twelve unpaid invoices and their amounts, as you asked me to do earlier today. Anything else?');
    expect(await voice.done).toBe('finished');
    expect(asked[0]).toBe('Hello there.');
    expect(asked.join(' ')).toContain('Anything else?');
  });

  it('stops at once', async () => {
    const sink = fakeSink();
    const voice = new ReplyVoice(async (_t, signal) => (async function* () {
      while (!signal.aborted) { yield pcm(0.05); await new Promise(r => setTimeout(r, 10)); }
    })(), sink);
    voice.finish('A long answer that keeps going.');
    await new Promise(r => setTimeout(r, 40));
    voice.stop();
    expect(await voice.done).toBe('stopped');
  });

  it('reports a failure when no voice could be fetched', async () => {
    const voice = new ReplyVoice(async () => { throw new Error('offline'); }, fakeSink());
    voice.finish('Hello.');
    expect(await voice.done).toBe('failed');
  });
});
