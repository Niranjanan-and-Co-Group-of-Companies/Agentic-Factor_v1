// Talking instead of typing, on one audio system (react-native-audio-api) for listening and speaking, so
// the two never fight over the speaker:
//   • the microphone, one turn at a time, measured by the speech detector shared with the website; the
//     recording becomes text on the server, in the language spoken;
//   • replies spoken smoothly — streamed sentence by sentence while they are written and played back to
//     back (@contracts speech). Both are billed like chat, at real cost.

import {
  loudness, newVad, ReplyVoice, SPEECH_SAMPLE_RATE, vadStep,
  type SpeechSink, type SpeechStream, type TranscriptionResult, type VadEvent, type VadState,
} from '@contracts';
import { fetch } from 'expo/fetch';
import { File, UploadType } from 'expo-file-system';
import { Alert, Linking } from 'react-native';
import {
  AudioContext, AudioManager, AudioRecorder, FileDirectory, FileFormat, FilePreset, type AudioBufferSourceNode,
} from 'react-native-audio-api';

import { authHeaders } from './api';
import { API_URL } from './config';

let sessionSet = false;
/** Listening and speaking share one session: sound comes from the loudspeaker (or headphones), never the earpiece. */
function speakerSession(): void {
  if (sessionSet) return;
  AudioManager.setAudioSessionOptions({
    iosCategory: 'playAndRecord',
    iosMode: 'default',
    iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP', 'allowBluetoothHFP'],
  });
  sessionSet = true;
}

let output: AudioContext | null = null;
/** Where replies play: at the voice's own rate (24 kHz), so nothing is resampled on the way. */
function speaker(): AudioContext {
  speakerSession();
  output ??= new AudioContext({ sampleRate: SPEECH_SAMPLE_RATE });
  if (output.state === 'suspended') void output.resume().catch(() => {});
  return output;
}

/** Asks for the microphone; when it was turned off, offers the phone's Settings. */
export async function micAllowed(): Promise<boolean> {
  const status = await AudioManager.requestRecordingPermissions();
  if (status === 'Granted') return true;
  Alert.alert('Microphone is off', 'Allow Agentic Factor to use the microphone in Settings to talk instead of typing.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open Settings', onPress: () => void Linking.openSettings() },
  ]);
  return false;
}

const fileUri = (path: string) => (path.startsWith('file://') ? path : `file://${path}`);

function remove(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch { /* already gone */ }
}

export interface Recording { uri: string; voicedMs: number; durationMs: number }

/** The microphone for one turn: records to a file and follows the level through the speech detector. */
export class MicTurn {
  private recorder = new AudioRecorder();
  private vad: VadState = newVad();
  private startedAt = 0;
  private active = false;

  /**
   * Starts recording (false when the microphone isn't allowed); `onTick` gets the level (0–1) and the
   * detector's event about ten times a second. Speaking into the message box passes a longer pause.
   */
  async start(onTick: (level: number, event: VadEvent) => void, limits?: { pauseMs?: number; maxMs?: number }): Promise<boolean> {
    if (!(await micAllowed())) return false;
    speakerSession();
    const out = this.recorder.enableFileOutput({
      format: FileFormat.M4A, channelCount: 1, preset: FilePreset.Low, directory: FileDirectory.Cache, fileNamePrefix: 'voice',
    });
    if (out.status === 'error') throw new Error(out.message);
    this.vad = newVad();
    let last = Date.now();
    this.recorder.onAudioReady({ sampleRate: 16_000, bufferLength: 1600, channelCount: 1 }, ({ buffer }) => {
      if (!this.active) return;
      const samples = buffer.getChannelData(0);
      let sum = 0;
      for (let k = 0; k < samples.length; k++) sum += samples[k] * samples[k];
      const db = 20 * Math.log10(Math.sqrt(sum / Math.max(1, samples.length)) || 1e-8);
      const now = Date.now();
      const r = vadStep(this.vad, db, now - last, limits);
      last = now;
      this.vad = r.state;
      onTick(loudness(db), r.event);
    });
    const started = await this.recorder.start();
    if (started.status === 'error') throw new Error(started.message);
    this.startedAt = Date.now();
    this.active = true;
    return true;
  }

  get seconds(): number { return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0; }

  /** Stops, and gives the recording with how much real voice was in it (null when nothing was recorded). */
  async stop(): Promise<Recording | null> {
    if (!this.active) return null;
    this.active = false;
    this.recorder.clearOnAudioReady();
    const measured = { voicedMs: this.vad.voicedMs, durationMs: Date.now() - this.startedAt };
    const done = await this.recorder.stop();
    if (done.status === 'error' || !done.paths?.[0]) return null;
    return { uri: fileUri(done.paths[0]), ...measured };
  }

  /** Stops and throws the recording away. */
  async cancel(): Promise<void> {
    const rec = await this.stop().catch(() => null);
    remove(rec?.uri);
  }
}

/** A recording's words, in the language spoken (the server skips one without enough real voice). */
export async function transcribe(rec: Recording): Promise<TranscriptionResult> {
  try {
    const res = await new File(rec.uri).upload(`${API_URL}/api/whisper/transcribe`, {
      uploadType: UploadType.MULTIPART,
      fieldName: 'audio',
      mimeType: 'audio/m4a',
      headers: await authHeaders(),
      parameters: { voicedMs: String(Math.round(rec.voicedMs)), durationMs: String(Math.round(rec.durationMs)) },
    });
    let data: Partial<TranscriptionResult> & { error?: string } = {};
    try { data = JSON.parse(res.body) as typeof data; } catch { /* not JSON */ }
    if (res.status < 200 || res.status >= 300) throw new Error(data.error ?? `Couldn't turn that into text (${res.status}).`);
    return { text: (data.text ?? '').trim(), language: data.language ?? null, ...(data.noSpeech ? { noSpeech: true } : {}) };
  } finally {
    remove(rec.uri);
  }
}

// ── Speaking ──

/** The voice for a piece of text, as it is made (raw 16-bit PCM, 24 kHz). */
const fetchSpeech: SpeechStream = async (text, signal) => {
  const res = await fetch(`${API_URL}/api/tts/stream`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
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

/** Plays samples back to back on the phone's speaker. */
class PhoneSink implements SpeechSink {
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
    this.next = at + samples.length / SPEECH_SAMPLE_RATE;
    this.sources.add(source);
    source.onEnded = () => { this.sources.delete(source); };
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

/** Speaks one reply: feed it the text as it is written (`update`), then `finish`. */
export function replyVoice(onSound: () => void): ReplyVoice {
  return new ReplyVoice(fetchSpeech, new PhoneSink(speaker(), onSound));
}
