// Light, dark, or the phone's setting — chosen in Account, kept on the phone, applied at start.

import * as SecureStore from 'expo-secure-store';
import { Appearance, Platform } from 'react-native';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'af.theme';

function apply(choice: ThemeChoice): void {
  if (Platform.OS === 'web') return;
  Appearance.setColorScheme(choice === 'system' ? 'auto' : choice);
}

export async function loadThemeChoice(): Promise<ThemeChoice> {
  if (Platform.OS === 'web') return 'system';
  const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
  const choice: ThemeChoice = saved === 'light' || saved === 'dark' ? saved : 'system';
  apply(choice);
  return choice;
}

export async function setThemeChoice(choice: ThemeChoice): Promise<void> {
  apply(choice);
  if (Platform.OS !== 'web') await SecureStore.setItemAsync(KEY, choice).catch(() => {});
}
