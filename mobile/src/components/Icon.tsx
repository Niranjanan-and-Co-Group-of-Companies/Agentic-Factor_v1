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
} satisfies Record<string, Name>;
