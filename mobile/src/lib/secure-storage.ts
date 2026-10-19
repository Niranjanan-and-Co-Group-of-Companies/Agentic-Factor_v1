// Where the sign-in session is kept: the phone's keychain (iOS) / keystore (Android). A session is
// larger than one secure entry should hold, so it is stored in chunks. The web build uses localStorage.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CHUNK = 1800;
// Secure keys may only contain letters, digits, ".", "-" and "_".
const keyOf = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

async function removeChunks(k: string): Promise<void> {
  const count = Number(await SecureStore.getItemAsync(`${k}.n`)) || 0;
  await Promise.all([
    ...Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${k}.${i}`)),
    SecureStore.deleteItemAsync(`${k}.n`),
  ]);
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    const k = keyOf(key);
    const count = Number(await SecureStore.getItemAsync(`${k}.n`)) || 0;
    if (count === 0) return null;
    const parts = await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${k}.${i}`)));
    return parts.some(p => p === null) ? null : parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') { globalThis.localStorage?.setItem(key, value); return; }
    const k = keyOf(key);
    await removeChunks(k);
    const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, 'g')) ?? [''];
    await Promise.all(parts.map((p, i) => SecureStore.setItemAsync(`${k}.${i}`, p)));
    await SecureStore.setItemAsync(`${k}.n`, String(parts.length));
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') { globalThis.localStorage?.removeItem(key); return; }
    await removeChunks(keyOf(key));
  },
};
