// The message box: typing; the microphone (speak, check the words, then send); and voice mode — a
// hands-free conversation that listens, sends when you pause, reads the reply aloud, and listens again.
//
// Only real speech counts (the speech detector in @contracts): silence, a fan or a knock is never sent
// to be transcribed, because transcription engines invent sentences from silence.

import { loudness, newVad, VAD, vadStep, type VadState } from '@contracts';
import { useAudioRecorderState } from 'expo-audio';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Speech } from '@/lib/useSpeech';
import { transcribe, useRecorder } from '@/lib/voice';
import { font, maxContentWidth, radius, space, useColors } from '@/theme';

import { Icon, icons } from '../Icon';
import { AppText } from '../ui';

/** The chat's latest reply, which voice mode reads aloud once it has finished. */
export interface LatestReply {
  key: string;
  id?: string;
  done: boolean;
  /** It carries a card to check and tap (a plan to approve, an app to connect…). */
  needsTap: boolean;
}

const VOICE = Platform.OS !== 'web';
const MAX_DICTATION_MS = 3 * 60_000;
const TICK_MS = 100;
/** After a reply is read aloud, a moment before listening, so its last sound isn't heard as speech. */
const AFTER_SPEAKING_MS = 400;
const NO_SPEECH = 'I didn’t catch any speech — try again a little closer to the phone.';

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Follows a recording's level ten times a second through the speech detector. */
function useSpeechDetector(recorder: ReturnType<typeof useRecorder>['recorder'], active: boolean, onEvent: (event: 'end' | 'nothing', vad: VadState) => void) {
  const vad = useRef<VadState>(newVad());
  const [level, setLevel] = useState(0);
  const handler = useRef(onEvent);
  useEffect(() => { handler.current = onEvent; });
  useEffect(() => {
    if (!active) return;
    vad.current = newVad();
    let lastMs = 0;
    const timer = setInterval(() => {
      const s = recorder.getStatus();
      if (!s.isRecording) return;
      const dt = Math.max(TICK_MS, s.durationMillis - lastMs);
      lastMs = s.durationMillis;
      if (s.metering === undefined) {
        // No level on this phone: it all counts as voice, and the circle (or the time limit) sends it.
        const elapsedMs = vad.current.elapsedMs + dt;
        vad.current = { ...vad.current, elapsedMs, voicedMs: vad.current.voicedMs + dt, heard: true };
        if (elapsedMs >= VAD.maxMs) handler.current('end', vad.current);
        return;
      }
      const r = vadStep(vad.current, s.metering, dt);
      vad.current = r.state;
      setLevel(loudness(s.metering));
      if (r.event !== 'none') handler.current(r.event, r.state);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [active, recorder]);
  /** Voice and length measured so far. */
  const measured = useCallback(() => ({ voicedMs: vad.current.voicedMs, durationMs: vad.current.elapsedMs }), []);
  return { level, measured };
}

export function Composer({ placeholder, sending, onSend, latest, speech }: {
  placeholder: string;
  sending: boolean;
  onSend: (text: string) => void;
  latest: LatestReply | null;
  speech: Speech;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'type' | 'dictate' | 'voice'>('type');
  const [note, setNote] = useState<string | null>(null);

  const submit = () => {
    const t = text.trim();
    if (!t || sending) return;
    setText('');
    onSend(t);
  };
  const begin = (next: 'dictate' | 'voice') => { setNote(null); speech.stop(); setMode(next); };

  return (
    <View style={[styles.composer, { borderTopColor: c.border, backgroundColor: c.bg, paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {mode === 'voice' ? (
        <VoiceMode sending={sending} onSend={onSend} latest={latest} speech={speech} onEnd={n => { setMode('type'); setNote(n); }} />
      ) : (
        <View style={[styles.inputWrap, { borderColor: c.border, backgroundColor: c.input }]}>
          {mode === 'dictate' ? (
            <Dictation onDone={(words, why) => {
              setMode('type');
              setNote(why ?? null);
              if (words) setText(t => (t.trim() ? `${t.trim()} ${words}` : words));
            }} />
          ) : (
            <>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={placeholder}
                placeholderTextColor={c.textMuted}
                style={[styles.input, { color: c.text }]}
                multiline
                maxLength={8000}
                accessibilityLabel="Message"
                submitBehavior="newline"
              />
              {VOICE && !text.trim() && !sending ? (
                <View style={styles.buttons}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Speak your message" onPress={() => begin('dictate')} hitSlop={6} style={({ pressed }) => [styles.round, { opacity: pressed ? 0.6 : 1 }]}>
                    <Icon name={icons.mic} size={20} color={c.textSecondary} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Voice mode: talk hands-free" onPress={() => begin('voice')} hitSlop={6} style={({ pressed }) => [styles.round, { backgroundColor: c.buttonBg, opacity: pressed ? 0.8 : 1 }]}>
                    <Icon name={icons.voice} size={18} color={c.buttonFg} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  accessibilityState={{ disabled: !text.trim() || sending }}
                  disabled={!text.trim() || sending}
                  onPress={submit}
                  hitSlop={8}
                  style={({ pressed }) => [styles.round, { backgroundColor: text.trim() && !sending ? c.buttonBg : c.border, opacity: pressed ? 0.8 : 1 }]}
                >
                  {sending ? <ActivityIndicator color={c.buttonFg} size="small" /> : <AppText weight="700" style={{ color: c.buttonFg }} maxFontSizeMultiplier={1.3}>↑</AppText>}
                </Pressable>
              )}
            </>
          )}
        </View>
      )}
      {note ? <AppText size="sm" tone="muted" style={styles.note}>{note}</AppText> : null}
    </View>
  );
}

/** Recording into the message box: ✕ throws it away, ✓ turns it into text to check before sending. */
function Dictation({ onDone }: { onDone: (words: string | null, why?: string) => void }) {
  const c = useColors();
  const { recorder, start, stop, cancel } = useRecorder();
  const status = useAudioRecorderState(recorder, 250);
  const [busy, setBusy] = useState(false);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  // Measures the voice in the recording (nothing ends a dictation but ✓ or the 3-minute cap).
  const { level, measured } = useSpeechDetector(recorder, status.isRecording && !busy, () => {});

  const finish = useCallback(async () => {
    setBusy(true);
    const sofar = measured();
    const uri = await stop();
    try {
      const heard = uri ? await transcribe(uri, sofar) : null;
      if (!heard || heard.noSpeech || !heard.text) done.current(null, NO_SPEECH);
      else done.current(heard.text);
    } catch (err) {
      Alert.alert("Couldn't hear that", (err as Error).message);
      done.current(null);
    }
  }, [measured, stop]);

  useEffect(() => {
    let live = true;
    let cap: ReturnType<typeof setTimeout> | undefined;
    start()
      .then(ok => {
        if (!live) return;
        if (!ok) done.current(null);
        else cap = setTimeout(() => void finish(), MAX_DICTATION_MS);
      })
      .catch(() => {
        if (!live) return;
        Alert.alert("Couldn't start the microphone", 'Another app may be using it. Try again in a moment.');
        done.current(null);
      });
    return () => { live = false; clearTimeout(cap); void cancel(); };
  }, [start, finish, cancel]);

  return (
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel recording" disabled={busy} onPress={() => done.current(null)} hitSlop={6} style={({ pressed }) => [styles.round, { opacity: pressed || busy ? 0.5 : 1 }]}>
        <Icon name={icons.close} size={18} color={c.textSecondary} />
      </Pressable>
      <View style={styles.barMiddle}>
        {busy ? (
          <>
            <ActivityIndicator color={c.textMuted} size="small" />
            <AppText tone="muted">Writing it down…</AppText>
          </>
        ) : (
          <>
            <View style={[styles.dot, { backgroundColor: c.rose, opacity: 0.45 + level * 0.55, transform: [{ scale: 1 + level * 0.5 }] }]} />
            <AppText tone="secondary" accessibilityLabel="Recording">{clock(status.durationMillis)}</AppText>
          </>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Done: turn it into text"
        disabled={busy || !status.isRecording}
        onPress={() => void finish()}
        hitSlop={6}
        style={({ pressed }) => [styles.round, { backgroundColor: status.isRecording && !busy ? c.buttonBg : c.border, opacity: pressed ? 0.8 : 1 }]}
      >
        <Icon name={icons.check} size={18} color={c.buttonFg} />
      </Pressable>
    </View>
  );
}

type Step = 'listening' | 'hearing' | 'thinking' | 'speaking' | 'ended';

const STEP_LABEL: Record<Step, string> = {
  listening: 'Listening — pause when you’re done',
  hearing: 'Writing down what you said…',
  thinking: 'Working on it…',
  speaking: 'Speaking — tap to interrupt',
  ended: '',
};

/** Hands-free: listen → send on a pause → read the reply aloud → listen again. Cards still need a tap. */
function VoiceMode({ sending, onSend, latest, speech, onEnd }: {
  sending: boolean;
  onSend: (text: string) => void;
  latest: LatestReply | null;
  speech: Speech;
  onEnd: (note: string | null) => void;
}) {
  useKeepAwake();
  const c = useColors();
  const { recorder, start, stop, cancel } = useRecorder();
  const { speak, stop: stopSpeaking } = speech;
  const [step, setStep] = useState<Step>('listening');
  const [unclear, setUnclear] = useState(false);
  const now = useRef<Step>('listening');
  /** The reply before this turn's message: the answer is the next one. */
  const before = useRef<string | null>(null);
  const latestProps = useRef({ onSend, onEnd, latest });
  useEffect(() => { latestProps.current = { onSend, onEnd, latest }; });

  const go = useCallback((next: Step) => { now.current = next; setStep(next); }, []);
  /** Where voice mode is now (it moves on while awaiting). */
  const at = useCallback((s: Step) => now.current === s, []);

  const end = useCallback((note: string | null) => {
    if (now.current === 'ended') return;
    go('ended');
    stopSpeaking();
    void cancel();
    latestProps.current.onEnd(note);
  }, [cancel, go, stopSpeaking]);

  const listen = useCallback(async () => {
    go('listening');
    try {
      if (!(await start())) return end(null);
    } catch {
      return end("Couldn't start the microphone. Try again in a moment.");
    }
    if (!at('listening')) void cancel(); // ended while starting
  }, [at, cancel, end, go, start]);

  /** The turn is over: transcribe it — or, with too little real voice, just listen again. */
  const send = useCallback(async (vad: VadState | null) => {
    if (!at('listening')) return;
    go('hearing');
    const uri = await stop();
    let words = '';
    try {
      // Tapping the circle sends what was recorded; the server still checks there was voice in it.
      const heard = uri ? await transcribe(uri, { voicedMs: vad?.voicedMs ?? 1000, durationMs: vad?.elapsedMs ?? 0 }) : null;
      words = heard && !heard.noSpeech ? heard.text : '';
    } catch (err) {
      return end((err as Error).message);
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
  }, [at, end, go, listen, stop]);

  const { level } = useSpeechDetector(recorder, step === 'listening', (event, vad) => {
    if (event === 'end') void send(vad);
    else end('Voice mode is off: I didn’t hear anything.');
  });

  // Start listening as soon as voice mode opens; stop everything when it closes.
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => { if (live) void listen(); });
    return () => { live = false; now.current = 'ended'; stopSpeaking(); void cancel(); };
  }, [cancel, listen, stopSpeaking]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'background') end(null); });
    return () => sub.remove();
  }, [end]);

  // The answer has finished: read it aloud, then listen again — or pause when it has a card to tap.
  useEffect(() => {
    if (step !== 'thinking' || sending || !latest?.done || latest.key === before.current) return;
    const reply = latest;
    void Promise.resolve().then(async () => {
      if (!at('thinking')) return;
      go('speaking');
      if (reply.id) await speak(reply.id);
      if (!at('speaking')) return;
      if (reply.needsTap) return end('Voice mode paused so you can check the card above.');
      await new Promise(r => setTimeout(r, AFTER_SPEAKING_MS));
      if (at('speaking')) void listen();
    });
  }, [step, sending, latest, at, end, go, listen, speak]);

  const onOrb = () => {
    if (step === 'listening') void send(null);
    else if (step === 'speaking') stopSpeaking();
  };
  const working = step === 'hearing' || step === 'thinking';
  const label = step === 'listening' && unclear ? 'Didn’t catch that — say it again' : STEP_LABEL[step];
  return (
    <View style={[styles.inputWrap, styles.voice, { borderColor: c.border, backgroundColor: c.input }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={step === 'listening' ? 'Send what I said' : step === 'speaking' ? 'Stop speaking' : label}
        disabled={step !== 'listening' && step !== 'speaking'}
        onPress={onOrb}
        style={[styles.orb, { backgroundColor: c.buttonBg, transform: [{ scale: step === 'listening' ? 1 + level * 0.3 : 1 }] }]}
      >
        {working
          ? <ActivityIndicator color={c.buttonFg} size="small" />
          : <Icon name={step === 'speaking' ? icons.speaker : icons.voice} size={20} color={c.buttonFg} />}
      </Pressable>
      <AppText tone="secondary" style={styles.voiceLabel} accessibilityLiveRegion="polite">{label}</AppText>
      <Pressable accessibilityRole="button" accessibilityLabel="End voice mode" onPress={() => end(null)} hitSlop={8} style={({ pressed }) => [styles.round, { backgroundColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
        <Icon name={icons.close} size={18} color={c.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingTop: space.sm, alignItems: 'center' },
  inputWrap: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderRadius: radius.xl, paddingLeft: space.md, paddingRight: 6, paddingVertical: 6, width: '100%', maxWidth: maxContentWidth },
  input: { flex: 1, fontSize: font.md, maxHeight: 140, paddingTop: 6, paddingBottom: 6 },
  buttons: { flexDirection: 'row', gap: 6 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: -space.sm },
  barMiddle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  voice: { alignItems: 'center', paddingLeft: 6, gap: space.md },
  orb: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  voiceLabel: { flex: 1 },
  note: { marginTop: 6, width: '100%', maxWidth: maxContentWidth, paddingHorizontal: space.sm },
});
