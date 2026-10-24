'use client';
// Voice and copy for the website's chats (Command Center and mission chat), as in the app:
//   • 🎙 speak into the message box (check the words, then send);
//   • voice mode — hands-free: listens, sends when you pause, reads the answer aloud, listens again;
//     it pauses when a reply has a card, so approvals stay a click;
//   • under each message: copy, and read aloud.
// Only real speech counts (the speech detector in @/lib/contracts/voice): silence and noise are never
// sent to be transcribed, because transcription engines invent sentences from silence.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AudioLines, Check, Copy, LoaderCircle, Mic, Square, Volume2, X } from 'lucide-react';

import { MicTurn, ReplySpeaker, transcribeRecording, type SpeechSource } from '@/lib/voice/web-voice';

/** The chat's latest reply, which voice mode reads aloud once it has finished. */
export interface LatestReply {
  key: string;
  id?: string;
  done: boolean;
  /** It carries a card to check and click (a plan to approve, an app to connect…). */
  needsTap: boolean;
}

type Step = 'listening' | 'hearing' | 'thinking' | 'speaking' | 'ended';

const MAX_DICTATION_S = 180;
const AFTER_SPEAKING_MS = 400;
const NO_SPEECH = 'I didn’t catch any speech — try again a little closer to the microphone.';
const NO_MIC = 'Allow the microphone for this site in your browser to talk instead of typing.';

const STEP_LABEL: Record<Step, string> = {
  listening: 'Listening — pause when you’re done',
  hearing: 'Writing down what you said…',
  thinking: 'Working on it…',
  speaking: 'Speaking — click to interrupt',
  ended: '',
};

/** Card types that only show something: voice mode carries on after them. */
const INFO_CARDS = new Set(['action_result', 'approval_record', 'run_card', 'thread_note', 'show_usage', 'show_missions']);

/** Whether a reply's card waits for the customer (voice mode pauses there). */
export function replyNeedsTap(action: { type?: string; resolved?: string } | null | undefined, applied?: boolean): boolean {
  return !!action?.type && !INFO_CARDS.has(action.type) && !applied && !action.resolved;
}

export function useChatVoice({ onSend, onDictated, latest, sending }: {
  onSend: (text: string) => void;
  /** Dictated words, for the message box. */
  onDictated: (text: string) => void;
  latest: LatestReply | null;
  sending: boolean;
}) {
  const speaker = useRef<ReplySpeaker | null>(null);
  const mic = useRef<MicTurn | null>(null);
  const [mode, setMode] = useState<'idle' | 'dictating' | 'transcribing' | 'voice'>('idle');
  const [step, setStep] = useState<Step>('ended');
  const now = useRef<Step>('ended');
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [unclear, setUnclear] = useState(false);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const speakingRef = useRef<string | null>(null);
  const before = useRef<string | null>(null);
  const latestProps = useRef({ onSend, onDictated, latest });
  useEffect(() => { latestProps.current = { onSend, onDictated, latest }; });

  const getSpeaker = useCallback(() => (speaker.current ??= new ReplySpeaker()), []);
  const go = useCallback((next: Step) => { now.current = next; setStep(next); }, []);
  /** Where voice mode is now (it moves on while awaiting). */
  const at = useCallback((s: Step) => now.current === s, []);

  // ── Read aloud ──
  const toggleSpeak = useCallback(async (key: string, source: SpeechSource) => {
    const s = getSpeaker();
    if (speakingRef.current === key) {
      s.stop();
      speakingRef.current = null;
      setSpeakingKey(null);
      return;
    }
    s.unlock();
    speakingRef.current = key;
    setSpeakingKey(key);
    const how = await s.speak(source);
    if (speakingRef.current === key) { speakingRef.current = null; setSpeakingKey(null); }
    if (how === 'failed') setNote('Couldn’t read that aloud. Please try again.');
  }, [getSpeaker]);

  // ── Speaking into the message box ──
  const finishDictation = useCallback(async () => {
    const m = mic.current;
    if (!m) return;
    mic.current = null;
    setMode('transcribing');
    const rec = await m.stop();
    try {
      const heard = rec ? await transcribeRecording(rec) : null;
      if (!heard || heard.noSpeech || !heard.text) setNote(NO_SPEECH);
      else latestProps.current.onDictated(heard.text);
    } catch (err) {
      setNote((err as Error).message);
    }
    setMode('idle');
  }, []);

  const startDictation = useCallback(async () => {
    setNote(null);
    getSpeaker().stop();
    const m = new MicTurn();
    mic.current = m;
    setSeconds(0);
    try {
      await m.start(l => {
        setLevel(l);
        setSeconds(Math.floor(m.seconds));
        if (m.seconds > MAX_DICTATION_S && mic.current === m) void finishDictation();
      });
      setMode('dictating');
    } catch {
      mic.current = null;
      setNote(NO_MIC);
    }
  }, [finishDictation, getSpeaker]);

  const cancelDictation = useCallback(() => {
    mic.current?.cancel();
    mic.current = null;
    setMode('idle');
  }, []);

  // ── Voice mode ──
  const endVoice = useCallback((message: string | null) => {
    if (now.current === 'ended') return;
    go('ended');
    mic.current?.cancel();
    mic.current = null;
    getSpeaker().stop();
    speakingRef.current = null;
    setSpeakingKey(null);
    setMode('idle');
    setNote(message);
  }, [getSpeaker, go]);

  const finishTurn = useRef<(m: MicTurn) => Promise<void>>(async () => {});
  const listen = useCallback(async () => {
    go('listening');
    const m = new MicTurn();
    mic.current = m;
    try {
      await m.start((l, event) => {
        if (now.current !== 'listening' || mic.current !== m) return;
        setLevel(l);
        if (event === 'end') void finishTurn.current(m);
        else if (event === 'nothing') endVoice('Voice mode is off: I didn’t hear anything.');
      });
    } catch {
      endVoice(NO_MIC);
    }
  }, [endVoice, go]);

  useEffect(() => {
    finishTurn.current = async (m: MicTurn) => {
      if (now.current !== 'listening' || mic.current !== m) return;
      mic.current = null;
      go('hearing');
      const rec = await m.stop();
      let words = '';
      try {
        const heard = rec ? await transcribeRecording(rec) : null;
        words = heard && !heard.noSpeech ? heard.text : '';
      } catch (err) {
        return endVoice((err as Error).message);
      }
      if (!at('hearing')) return;
      if (!words) {
        setUnclear(true);
        return void listen();
      }
      setUnclear(false);
      before.current = latestProps.current.latest?.key ?? null;
      go('thinking');
      latestProps.current.onSend(words);
    };
  }, [at, endVoice, go, listen]);

  const startVoice = useCallback(() => {
    setNote(null);
    setUnclear(false);
    const s = getSpeaker();
    s.unlock();
    s.stop();
    setMode('voice');
    void listen();
  }, [getSpeaker, listen]);

  /** The circle: send now while listening, stop the reading while speaking. */
  const tapOrb = useCallback(() => {
    if (now.current === 'listening' && mic.current) void finishTurn.current(mic.current);
    else if (now.current === 'speaking') getSpeaker().stop();
  }, [getSpeaker]);

  // The answer has finished: read it aloud, then listen again — or pause when it has a card to click.
  useEffect(() => {
    if (mode !== 'voice' || step !== 'thinking' || sending || !latest?.done || latest.key === before.current) return;
    const reply = latest;
    void Promise.resolve().then(async () => {
      if (now.current !== 'thinking') return;
      go('speaking');
      if (reply.id) {
        speakingRef.current = reply.key;
        setSpeakingKey(reply.key);
        await getSpeaker().speak({ messageId: reply.id });
        if (speakingRef.current === reply.key) { speakingRef.current = null; setSpeakingKey(null); }
      }
      if (!at('speaking')) return;
      if (reply.needsTap) return endVoice('Voice mode paused so you can check the card above.');
      await new Promise(r => setTimeout(r, AFTER_SPEAKING_MS));
      if (at('speaking')) void listen();
    });
  }, [mode, step, sending, latest, at, endVoice, getSpeaker, go, listen]);

  // Keep the screen on in voice mode; stop everything when the chat closes.
  useEffect(() => {
    if (mode !== 'voice' || !('wakeLock' in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as Navigator & { wakeLock: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } })
      .wakeLock.request('screen').then(l => { lock = l; }).catch(() => {});
    return () => { void lock?.release().catch(() => {}); };
  }, [mode]);
  useEffect(() => () => { now.current = 'ended'; mic.current?.cancel(); speaker.current?.stop(); }, []);

  return {
    mode, step, level, seconds, note, unclear, speakingKey,
    label: step === 'listening' && unclear ? 'Didn’t catch that — say it again' : STEP_LABEL[step],
    setNote, toggleSpeak, startDictation, finishDictation, cancelDictation, startVoice, endVoice, tapOrb,
  };
}

export type ChatVoice = ReturnType<typeof useChatVoice>;

// ── Pieces of the chat UI ──

const iconButton: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4,
  display: 'inline-flex', alignItems: 'center', borderRadius: 6,
};

/** Copy and read aloud, under a message. */
export function MessageActions({ text, voice, speakKey, source, align = 'left' }: {
  text: string;
  voice?: ChatVoice;
  /** Read aloud (replies only): this message's key and what to speak. */
  speakKey?: string;
  source?: SpeechSource;
  align?: 'left' | 'right';
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch { /* the browser refused */ }
  };
  const speaking = !!speakKey && voice?.speakingKey === speakKey;
  return (
    <div style={{ display: 'flex', gap: 2, marginTop: 2, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <button type="button" onClick={() => void copy()} title={copied ? 'Copied' : 'Copy'} aria-label={copied ? 'Copied' : 'Copy'} style={{ ...iconButton, color: copied ? 'var(--emerald)' : 'var(--text-muted)' }}>
        {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
      </button>
      {voice && speakKey && source ? (
        <button type="button" onClick={() => void voice.toggleSpeak(speakKey, source)} title={speaking ? 'Stop reading' : 'Read aloud'} aria-label={speaking ? 'Stop reading aloud' : 'Read aloud'} style={{ ...iconButton, color: speaking ? 'var(--accent)' : 'var(--text-muted)' }}>
          {speaking ? <Square size={13} strokeWidth={2} /> : <Volume2 size={14} strokeWidth={1.75} />}
        </button>
      ) : null}
    </div>
  );
}

const squareButton = (active = false): CSSProperties => ({
  flexShrink: 0, width: 40, height: 40, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
  background: active ? 'var(--text-primary)' : 'var(--bg-card)', color: active ? 'var(--bg-primary)' : 'var(--text-secondary)',
});

/** 🎙 (speak into the box) and voice mode, next to the message box. */
export function VoiceButtons({ voice, disabled }: { voice: ChatVoice; disabled?: boolean }) {
  return (
    <>
      <button type="button" onClick={() => void voice.startDictation()} disabled={disabled} title="Speak your message" aria-label="Speak your message" style={{ ...squareButton(), opacity: disabled ? 0.4 : 1 }}>
        <Mic size={17} strokeWidth={1.75} />
      </button>
      <button type="button" onClick={voice.startVoice} disabled={disabled} title="Voice mode: talk hands-free" aria-label="Voice mode: talk hands-free" style={{ ...squareButton(true), opacity: disabled ? 0.4 : 1 }}>
        <AudioLines size={17} strokeWidth={1.75} />
      </button>
    </>
  );
}

const bar: CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', gap: 10, minHeight: 42, padding: '4px 6px',
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
};

/** Recording into the message box: ✕ throws it away, ✓ turns it into text. */
export function DictationBar({ voice }: { voice: ChatVoice }) {
  const busy = voice.mode === 'transcribing';
  return (
    <div style={bar} role="group" aria-label="Recording">
      <button type="button" onClick={voice.cancelDictation} disabled={busy} title="Cancel" aria-label="Cancel recording" style={{ ...iconButton, opacity: busy ? 0.4 : 1 }}><X size={16} /></button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        {busy ? (
          <><LoaderCircle size={15} style={{ animation: 'spin 1s linear infinite' }} /> Writing it down…</>
        ) : (
          <>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--rose)', opacity: 0.45 + voice.level * 0.55, transform: `scale(${1 + voice.level * 0.5})`, transition: 'transform 0.1s' }} />
            {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, '0')}
          </>
        )}
      </div>
      <button type="button" onClick={() => void voice.finishDictation()} disabled={busy} title="Done" aria-label="Done: turn it into text" style={{ ...squareButton(true), width: 32, height: 32, opacity: busy ? 0.4 : 1 }}>
        <Check size={16} />
      </button>
    </div>
  );
}

/** Voice mode in place of the message box. */
export function VoiceModeBar({ voice }: { voice: ChatVoice }) {
  const working = voice.step === 'hearing' || voice.step === 'thinking';
  const canTap = voice.step === 'listening' || voice.step === 'speaking';
  return (
    <div style={bar} role="group" aria-label="Voice mode">
      <button
        type="button"
        onClick={voice.tapOrb}
        disabled={!canTap}
        aria-label={voice.step === 'listening' ? 'Send what I said' : voice.step === 'speaking' ? 'Stop speaking' : voice.label}
        style={{
          width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: canTap ? 'pointer' : 'default', flexShrink: 0,
          background: 'var(--text-primary)', color: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: `scale(${voice.step === 'listening' ? 1 + voice.level * 0.3 : 1})`, transition: 'transform 0.1s',
        }}
      >
        {working ? <LoaderCircle size={17} style={{ animation: 'spin 1s linear infinite' }} /> : voice.step === 'speaking' ? <Volume2 size={17} /> : <AudioLines size={17} />}
      </button>
      <span aria-live="polite" style={{ flex: 1, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>{voice.label}</span>
      <button type="button" onClick={() => voice.endVoice(null)} title="End voice mode" aria-label="End voice mode" style={{ ...squareButton(), width: 34, height: 34 }}>
        <X size={16} />
      </button>
    </div>
  );
}

/** A line under the message box: why voice stopped, or what to try. */
export function VoiceNote({ voice }: { voice: ChatVoice }) {
  if (!voice.note) return null;
  return (
    <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
      <span>{voice.note}</span>
      <button type="button" onClick={() => voice.setNote(null)} aria-label="Dismiss" style={{ ...iconButton, padding: 0 }}><X size={12} /></button>
    </div>
  );
}
