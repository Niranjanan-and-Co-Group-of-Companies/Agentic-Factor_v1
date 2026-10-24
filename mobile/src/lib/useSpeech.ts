// Reads replies aloud, one at a time and part by part (the next part loads while one plays); stops when
// the app goes to the background or the chat closes.

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { speechPartCount, speechPartFile } from './voice';

export type SpeechEnd = 'finished' | 'stopped' | 'failed';

interface Playing { player: AudioPlayer | null; stopped: boolean; wake: (() => void) | null; end: (how: SpeechEnd) => void }

export function useSpeech() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const playing = useRef<Playing | null>(null);

  const stop = useCallback(() => playing.current?.end('stopped'), []);

  /** Speaks a saved reply, stopping any other; resolves when it ends. */
  const speak = useCallback((messageId: string) => new Promise<SpeechEnd>(resolve => {
    playing.current?.end('stopped');
    const me: Playing = {
      player: null,
      stopped: false,
      wake: null,
      end: how => {
        if (playing.current !== me) return;
        playing.current = null;
        me.stopped = true;
        me.player?.remove();
        me.player = null;
        me.wake?.();
        setSpeakingId(null);
        resolve(how);
      },
    };
    playing.current = me;
    setSpeakingId(messageId);
    void (async () => {
      try {
        const count = await speechPartCount(messageId);
        let next = speechPartFile(messageId, 0).catch(() => null);
        for (let part = 0; part < count; part++) {
          const file = await next;
          if (me.stopped) return;
          if (!file) throw new Error('A part could not be loaded.');
          if (part + 1 < count) next = speechPartFile(messageId, part + 1).catch(() => null);
          if (part === 0) await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
          if (me.stopped) return;
          await new Promise<void>(done => {
            // A part that never reports its end (a broken file) is given up on after its length.
            const guard = setTimeout(done, file.seconds * 1000 + 8000);
            me.wake = () => { clearTimeout(guard); done(); };
            me.player = createAudioPlayer(file.uri);
            me.player.addListener('playbackStatusUpdate', status => { if (status.didJustFinish) me.wake?.(); });
            me.player.play();
          });
          me.wake = null;
          if (me.stopped) return;
          me.player?.remove();
          me.player = null;
        }
        me.end('finished');
      } catch {
        me.end('failed');
      }
    })();
  }), []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state === 'background') stop(); });
    return () => { sub.remove(); stop(); };
  }, [stop]);

  return { speakingId, speak, stop };
}

export type Speech = ReturnType<typeof useSpeech>;
