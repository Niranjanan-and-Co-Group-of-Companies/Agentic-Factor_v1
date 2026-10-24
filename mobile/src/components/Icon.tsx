// System icons: SF Symbols on iOS, Material Symbols on Android and the web.

import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';

type Name = ComponentProps<typeof SymbolView>['name'];

export function Icon({ name, size = 22, color }: { name: Name; size?: number; color: string }) {
  return <SymbolView name={name} size={size} tintColor={color} />;
}

export const icons = {
  menu: { ios: 'line.3.horizontal', android: 'menu', web: 'menu' },
  newChat: { ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  account: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  mic: { ios: 'mic', android: 'mic', web: 'mic' },
  voice: { ios: 'waveform', android: 'graphic_eq', web: 'graphic_eq' },
  speaker: { ios: 'speaker.wave.2', android: 'volume_up', web: 'volume_up' },
  stop: { ios: 'stop.fill', android: 'stop', web: 'stop' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  copy: { ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' },
  language: { ios: 'globe', android: 'language', web: 'language' },
} satisfies Record<string, Name>;
