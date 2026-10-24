// The message box: typing; + (a photo from the camera or library, or a file); the microphone (speak, it
// stops when you pause, check the words, then send); and voice mode — a hands-free conversation that
// listens, sends when you pause, speaks the answer while it is being written, and listens again.
//
// Only real speech counts (the speech detector in @contracts): silence, a fan or a knock is never sent
// to be transcribed, because transcription engines invent sentences from silence.

import { VAD, type ReplyVoice, type VadEvent } from '@contracts';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pickAttachment, uploadAttachment } from '@/lib/attachments';
import type { Speech } from '@/lib/useSpeech';
import { MicTurn, transcribe } from '@/lib/voice';
import { font, maxContentWidth, radius, space, useColors } from '@/theme';

import { Icon, icons } from '../Icon';
import { AppText } from '../ui';

/** The chat's latest reply, which voice mode speaks while it is being written. */
export interface LatestReply {
  key: string;
  id?: string;
  /** Its text so far. */
  text: string;
  done: boolean;
  /** It carries a card to check and tap (a plan to approve, an app to connect…). */
  needsTap: boolean;
}

const VOICE = Platform.OS !== 'web';
/** After a reply is read aloud, a moment before listening, so its last sound isn't heard as speech. */
const AFTER_SPEAKING_MS = 400;
const NO_SPEECH = 'I didn’t catch any speech — try again a little closer to the phone.';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

interface Shared { name: string; uploading: boolean; error?: string }

export function Composer({ placeholder, sending, onSend, latest, speech, missionId }: {
  placeholder: string;
  sending: boolean;
  onSend: (text: string) => void;
  latest: LatestReply | null;
  speech: Speech;
  /** Files shared in a mission's chat belong to that mission. */
  missionId?: string;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'type' | 'dictate' | 'voice'>('type');
  const [note, setNote] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [shared, setShared] = useState<Shared | null>(null);

  const canSend = (!!text.trim() || (!!shared && !shared.uploading && !shared.error)) && !sending && !shared?.uploading;
  const submit = () => {
    if (!canSend) return;
    const t = text.trim();
    const file = shared && !shared.error ? shared.name : null;
    setText('');
    setShared(null);
    onSend(file ? `[Attached: ${file}]${t ? `\n\n${t}` : ''}` : t);
  };
  const begin = (next: 'dictate' | 'voice') => { setNote(null); setMenu(false); speech.stop(); setMode(next); };

  const share = async (from: 'camera' | 'photos' | 'file') => {
    setMenu(false);
    try {
      const picked = await pickAttachment(from);
      if (!picked) return;
      setShared({ name: picked.name, uploading: true });
      await uploadAttachment(picked, missionId);
      setShared({ name: picked.name, uploading: false });
    } catch (err) {
      setShared(s => (s ? { ...s, uploading: false, error: (err as Error).message } : null));
    }
  };

  return (
    <View style={[styles.composer, { borderTopColor: c.border, backgroundColor: c.bg, paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {shared ? (
        <View style={[styles.chip, { borderColor: shared.error ? c.rose : c.border, backgroundColor: c.card }]}>
          {shared.uploading ? <ActivityIndicator size="small" color={c.textMuted} /> : <Icon name={icons.attachment} size={14} color={shared.error ? c.rose : c.textSecondary} />}
          <AppText size="sm" numberOfLines={1} style={{ flexShrink: 1 }} tone={shared.error ? 'rose' : 'secondary'}>
            {shared.error ? `${shared.name}: ${shared.error}` : shared.name}
          </AppText>
          {!shared.uploading ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Remove the file" onPress={() => setShared(null)} hitSlop={8}>
              <Icon name={icons.close} size={14} color={c.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {menu && mode === 'type' ? (
        <View style={styles.menu}>
          {([['camera', icons.camera, 'Camera'], ['photos', icons.photo, 'Photos'], ['file', icons.file, 'File']] as const).map(([from, icon, label]) => (
            <Pressable key={from} accessibilityRole="button" accessibilityLabel={`Share from ${label}`} onPress={() => void share(from)} style={({ pressed }) => [styles.menuItem, { borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.7 : 1 }]}>
              <Icon name={icon} size={18} color={c.text} />
              <AppText size="sm" weight="600">{label}</AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
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
              {VOICE ? (
                <Pressable accessibilityRole="button" accessibilityLabel={menu ? 'Close' : 'Share a photo or file'} onPress={() => setMenu(m => !m)} hitSlop={6} style={({ pressed }) => [styles.round, styles.plus, { opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name={menu ? icons.close : icons.plus} size={20} color={c.textSecondary} />
                </Pressable>
              ) : null}
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
              {VOICE && !canSend && !sending && !shared ? (
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
                  accessibilityState={{ disabled: !canSend }}
                  disabled={!canSend}
                  onPress={submit}
                  hitSlop={8}
                  style={({ pressed }) => [styles.round, { backgroundColor: canSend ? c.buttonBg : c.border, opacity: pressed ? 0.8 : 1 }]}
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

/** Starts a microphone turn when mounted; stops it when unmounted. */
function useMicTurn(onEvent: (event: VadEvent, turn: MicTurn) => void, limits?: { pauseMs?: number; maxMs?: number }) {
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const handler = useRef(onEvent);
  useEffect(() => { handler.current = onEvent; });
  const turn = useRef<MicTurn | null>(null);

  /** Starts listening: false when the microphone isn't allowed, or it was stopped meanwhile. */
  const start = useCallback(async (): Promise<boolean> => {
    const m = new MicTurn();
    turn.current = m;
    setLevel(0);
    setSeconds(0);
    const ok = await m.start((l, event) => {
      if (turn.current !== m) return;
      setLevel(l);
      setSeconds(m.seconds);
      if (event !== 'none') handler.current(event, m);
    }, limits);
    if (!ok || turn.current !== m) {
      if (ok) void m.cancel();
      return false;
    }
    return true;
  }, [limits]);

  /** Stops the turn, giving the recording (null when there was none). */
  const stop = useCallback(async () => {
    const m = turn.current;
    turn.current = null;
    return m ? m.stop() : null;
  }, []);

  const cancel = useCallback(() => {
    const m = turn.current;
    turn.current = null;
    void m?.cancel();
  }, []);

  useEffect(() => () => { void turn.current?.cancel(); turn.current = null; }, []);
  return { level, seconds, start, stop, cancel };
}

const DICTATION = { pauseMs: VAD.dictationPauseMs, maxMs: VAD.dictationMaxMs };

/** Recording into the message box: stops by itself when you pause (or ✓); ✕ throws it away. */
function Dictation({ onDone }: { onDone: (words: string | null, why?: string) => void }) {
  const c = useColors();
  const [busy, setBusy] = useState<'starting' | 'recording' | 'writing'>('starting');
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  const finishing = useRef(false);

  const finish = useRef<() => Promise<void>>(async () => {});
  const mic = useMicTurn((event, turn) => {
    if (event === 'end') void finish.current();
    else { void turn.cancel(); done.current(null, NO_SPEECH); }
  }, DICTATION);
  useEffect(() => {
    finish.current = async () => {
      if (finishing.current) return;
      finishing.current = true;
      setBusy('writing');
      const rec = await mic.stop();
      try {
        const heard = rec ? await transcribe(rec) : null;
        if (!heard || heard.noSpeech || !heard.text) done.current(null, NO_SPEECH);
        else done.current(heard.text);
      } catch (err) {
        Alert.alert("Couldn't hear that", (err as Error).message);
        done.current(null);
      }
    };
  });

  const { start } = mic;
  useEffect(() => {
    let live = true;
    start()
      .then(ok => {
        if (!live) return;
        if (ok) setBusy('recording');
        else done.current(null);
      })
      .catch(() => {
        if (!live) return;
        Alert.alert("Couldn't start the microphone", 'Another app may be using it. Try again in a moment.');
        done.current(null);
      });
    return () => { live = false; };
  }, [start]);

  const recording = busy === 'recording';
  return (
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel recording" disabled={busy === 'writing'} onPress={() => { mic.cancel(); done.current(null); }} hitSlop={6} style={({ pressed }) => [styles.round, { opacity: pressed || busy === 'writing' ? 0.5 : 1 }]}>
        <Icon name={icons.close} size={18} color={c.textSecondary} />
      </Pressable>
      <View style={styles.barMiddle}>
        {!recording ? (
          <>
            <ActivityIndicator color={c.textMuted} size="small" />
            <AppText tone="muted">{busy === 'starting' ? 'Starting the microphone…' : 'Writing it down…'}</AppText>
          </>
        ) : (
          <>
            <View style={[styles.dot, { backgroundColor: c.rose, opacity: 0.45 + mic.level * 0.55, transform: [{ scale: 1 + mic.level * 0.5 }] }]} />
            <AppText tone="secondary" accessibilityLabel="Recording">{clock(mic.seconds)}</AppText>
            <AppText size="sm" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>· stops when you pause</AppText>
          </>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Done: turn it into text"
        disabled={!recording}
        onPress={() => void finish.current()}
        hitSlop={6}
        style={({ pressed }) => [styles.round, { backgroundColor: recording ? c.buttonBg : c.border, opacity: pressed ? 0.8 : 1 }]}
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

/** Hands-free: listen → send on a pause → speak the answer while it is written → listen again. */
function VoiceMode({ sending, onSend, latest, speech, onEnd }: {
  sending: boolean;
  onSend: (text: string) => void;
  latest: LatestReply | null;
  speech: Speech;
  onEnd: (note: string | null) => void;
}) {
  useKeepAwake();
  const c = useColors();
  const { read, rename, stop: stopSpeaking } = speech;
  const [step, setStep] = useState<Step>('listening');
  const [unclear, setUnclear] = useState(false);
  const now = useRef<Step>('listening');
  /** The reply that was last when you spoke: the answer is the one after it. */
  const before = useRef<string | null>(null);
  /** This turn's answer, spoken while it is written. */
  const answer = useRef<ReplyVoice | null>(null);
  const latestProps = useRef({ onSend, onEnd, latest });
  useEffect(() => { latestProps.current = { onSend, onEnd, latest }; });

  const go = useCallback((next: Step) => { now.current = next; setStep(next); }, []);
  /** Where voice mode is now (it moves on while awaiting). */
  const at = useCallback((s: Step) => now.current === s, []);

  const send = useRef<() => Promise<void>>(async () => {});
  const ending = useRef<(note: string | null) => void>(() => {});
  const mic = useMicTurn(event => {
    if (!at('listening')) return;
    if (event === 'end') void send.current();
    else ending.current('Voice mode is off: I didn’t hear anything.');
  });
  const { start: startMic, stop: stopMic, cancel: cancelMic } = mic;

  const end = useCallback((note: string | null) => {
    if (now.current === 'ended') return;
    go('ended');
    answer.current = null;
    stopSpeaking();
    cancelMic();
    latestProps.current.onEnd(note);
  }, [cancelMic, go, stopSpeaking]);

  useEffect(() => { ending.current = end; });

  const listen = useCallback(async () => {
    go('listening');
    try {
      if (!(await startMic()) && at('listening')) end(null);
    } catch {
      end("Couldn't start the microphone. Try again in a moment.");
    }
  }, [at, end, go, startMic]);

  /** The turn is over: transcribe it — or, with too little real voice, just listen again. */
  useEffect(() => {
    send.current = async () => {
      if (!at('listening')) return;
      go('hearing');
      const rec = await stopMic();
      let words = '';
      try {
        const heard = rec ? await transcribe(rec) : null;
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
      answer.current = null;
      go('thinking');
      latestProps.current.onSend(words);
    };
  });

  // Start listening as soon as voice mode opens; stop everything when it closes.
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => { if (live) void listen(); });
    return () => { live = false; now.current = 'ended'; stopSpeaking(); cancelMic(); };
  }, [cancelMic, listen, stopSpeaking]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'background') end(null); });
    return () => sub.remove();
  }, [end]);

  // The answer is being written: speak it as it comes, then listen again — or pause at a card.
  useEffect(() => {
    if (!latest || latest.key === before.current) return;
    if (!at('thinking') && !at('speaking')) return;
    const { key, text } = latest;
    const final = latest.done && !sending;
    const voice = answer.current;
    if (voice) {
      if (final) voice.finish(text);
      else voice.update(text);
      void Promise.resolve().then(() => rename(voice, key));
      return;
    }
    if (!at('thinking') || (!text.trim() && !final)) return;
    void Promise.resolve().then(() => {
      if (answer.current || !at('thinking')) return;
      const started = read(key);
      answer.current = started;
      go('speaking');
      void started.done.then(async how => {
        if (answer.current !== started) return;
        answer.current = null;
        if (!at('speaking')) return;
        if (how !== 'stopped' && latestProps.current.latest?.needsTap) return end('Voice mode paused so you can check the card above.');
        await new Promise(r => setTimeout(r, AFTER_SPEAKING_MS));
        if (at('speaking')) void listen();
      });
      if (final) started.finish(text);
      else started.update(text);
    });
  }, [step, sending, latest, at, end, go, listen, read, rename]);

  const onOrb = () => {
    if (step === 'listening') void send.current();
    else if (step === 'speaking') answer.current?.stop();
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
        style={[styles.orb, { backgroundColor: c.buttonBg, transform: [{ scale: step === 'listening' ? 1 + mic.level * 0.3 : 1 }] }]}
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
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingTop: space.sm, alignItems: 'center', gap: space.sm },
  inputWrap: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderRadius: radius.xl, paddingLeft: space.md, paddingRight: 6, paddingVertical: 6, width: '100%', maxWidth: maxContentWidth },
  input: { flex: 1, fontSize: font.md, maxHeight: 140, paddingTop: 6, paddingBottom: 6 },
  buttons: { flexDirection: 'row', gap: 6 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  plus: { marginLeft: -space.sm, marginRight: 2 },
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: -space.sm },
  barMiddle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  voice: { alignItems: 'center', paddingLeft: 6, gap: space.md },
  orb: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  voiceLabel: { flex: 1 },
  note: { width: '100%', maxWidth: maxContentWidth, paddingHorizontal: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6, maxWidth: '100%' },
  menu: { flexDirection: 'row', gap: space.sm, alignSelf: 'flex-start' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 40 },
});
