// Reads replies aloud, one at a time; stops when the app goes to the background or the chat closes.

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { speechFile } from './voice';

export type SpeechEnd = 'finished' | 'stopped' | 'failed';

interface Playing { player: AudioPlayer | null; end: (how: SpeechEnd) => void }

export function useSpeech() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const playing = useRef<Playing | null>(null);

  const stop = useCallback(() => playing.current?.end('stopped'), []);

  /** Speaks a saved reply, stopping any other; resolves when it ends. */
  const speak = useCallback((messageId: string) => new Promise<SpeechEnd>(resolve => {
    playing.current?.end('stopped');
    const me: Playing = {
      player: null,
      end: how => {
        if (playing.current !== me) return;
        playing.current = null;
        me.player?.remove();
        setSpeakingId(null);
        resolve(how);
      },
    };
    playing.current = me;
    setSpeakingId(messageId);
    void (async () => {
      try {
        const uri = await speechFile(messageId);
        if (playing.current !== me) return;
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        if (playing.current !== me) return;
        me.player = createAudioPlayer(uri);
        me.player.addListener('playbackStatusUpdate', status => { if (status.didJustFinish) me.end('finished'); });
        me.player.play();
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
