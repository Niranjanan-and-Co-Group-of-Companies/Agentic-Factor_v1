// Reads replies aloud, one at a time: streamed sentence by sentence and played without gaps. Stops when
// the app goes to the background or the chat closes.

import type { ReplyVoice } from '@contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { replyVoice } from './voice';

export function useSpeech() {
  /** The reply being read aloud, and whether its first words are still being prepared. */
  const [speaking, setSpeaking] = useState<{ key: string; playing: boolean } | null>(null);
  const current = useRef<{ key: string; voice: ReplyVoice } | null>(null);

  const stop = useCallback(() => {
    current.current?.voice.stop();
    current.current = null;
    setSpeaking(null);
  }, []);

  /** Starts reading a reply (stopping any other): feed it with update/finish; `done` says how it ended. */
  const read = useCallback((key: string) => {
    current.current?.voice.stop();
    setSpeaking({ key, playing: false });
    const voice = replyVoice(() => setSpeaking(s => (s && s.key === key && !s.playing ? { key, playing: true } : s)));
    current.current = { key, voice };
    void voice.done.then(() => {
      if (current.current?.voice !== voice) return;
      current.current = null;
      setSpeaking(null);
    });
    return voice;
  }, []);

  /** The message's read-aloud button: reads the whole text, or stops it. */
  const toggle = useCallback((key: string, text: string) => {
    if (current.current?.key === key) {
      stop();
      return null;
    }
    const voice = read(key);
    voice.finish(text);
    return voice;
  }, [read, stop]);

  /** Voice mode's reply gets its id once saved: the button under it should show it is speaking. */
  const rename = useCallback((voice: ReplyVoice, key: string) => {
    if (current.current?.voice !== voice || current.current.key === key) return;
    current.current = { key, voice };
    setSpeaking(s => (s ? { ...s, key } : s));
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state === 'background') stop(); });
    return () => { sub.remove(); stop(); };
  }, [stop]);

  return { speaking, read, toggle, stop, rename };
}

export type Speech = ReturnType<typeof useSpeech>;
