// Talking instead of typing: a recording becomes text on the server (in the language spoken — Hindi,
// Tamil, English…), and a saved reply can be read aloud. Both are billed like chat, at real cost.

import {
  requestRecordingPermissionsAsync, RecordingPresets, setAudioModeAsync, useAudioRecorder, type RecordingOptions,
} from 'expo-audio';
import { File, Paths, UploadType } from 'expo-file-system';
import { useCallback } from 'react';
import { Alert, Linking } from 'react-native';

import { authHeaders } from './api';
import { API_URL } from './config';

// Speech only: mono at 64 kbps keeps a minute near 0.5 MB, so uploads stay quick on mobile data.
const RECORDING: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000, isMeteringEnabled: true };

function remove(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch { /* already gone */ }
}

/** A recording's words, in the language they were spoken. The recording is deleted afterwards. */
export async function transcribe(uri: string): Promise<string> {
  try {
    const res = await new File(uri).upload(`${API_URL}/api/whisper/transcribe`, {
      uploadType: UploadType.MULTIPART, fieldName: 'audio', mimeType: 'audio/m4a', headers: await authHeaders(),
    });
    let data: { text?: string; error?: string } = {};
    try { data = JSON.parse(res.body) as typeof data; } catch { /* not JSON */ }
    if (res.status < 200 || res.status >= 300) throw new Error(data.error ?? `Couldn't turn that into text (${res.status}).`);
    return (data.text ?? '').trim();
  } finally {
    remove(uri);
  }
}

/** A saved reply as speech: fetched once and kept in the cache, so playing it again costs nothing. */
export async function speechFile(messageId: string): Promise<string> {
  const file = new File(Paths.cache, `reply-${messageId}.mp3`);
  if (file.exists && (file.size ?? 0) > 200) return file.uri;
  const saved = await File.downloadFileAsync(
    `${API_URL}/api/tts?messageId=${encodeURIComponent(messageId)}`, file, { headers: await authHeaders(), idempotent: true },
  );
  // A refusal comes back as a few bytes of text, not audio.
  if ((saved.size ?? 0) <= 200) {
    remove(saved.uri);
    throw new Error('Could not read this reply aloud.');
  }
  return saved.uri;
}

/** Asks for the microphone; when it was turned off, offers the phone's Settings. */
async function micAllowed(): Promise<boolean> {
  const { granted } = await requestRecordingPermissionsAsync();
  if (granted) return true;
  Alert.alert('Microphone is off', 'Allow Agentic Factor to use the microphone in Settings to talk instead of typing.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open Settings', onPress: () => void Linking.openSettings() },
  ]);
  return false;
}

/** A recorder for speech; read its level (dB) and length with recorder.getStatus(). */
export function useRecorder() {
  const recorder = useAudioRecorder(RECORDING);

  /** Starts recording; false when the microphone isn't allowed. */
  const start = useCallback(async (): Promise<boolean> => {
    if (!(await micAllowed())) return false;
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    return true;
  }, [recorder]);

  /** Stops and gives the recording's file (null when nothing was recorded). */
  const stop = useCallback(async (): Promise<string | null> => {
    let uri: string | null = null;
    try {
      if (recorder.isRecording) {
        await recorder.stop();
        uri = recorder.uri;
      }
    } catch { /* the recorder was already released */ }
    // Recording mode sends sound to the earpiece on iPhone: back to the speaker for replies.
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    return uri;
  }, [recorder]);

  /** Stops and throws the recording away. */
  const cancel = useCallback(async () => remove(await stop()), [stop]);

  return { recorder, start, stop, cancel };
}
