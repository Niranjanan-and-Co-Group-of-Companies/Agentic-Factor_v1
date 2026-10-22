// The Agentic Factor mark (AF), in dark ink on light screens and light ink on dark ones.

import { Image } from 'expo-image';
import { useColorScheme, View } from 'react-native';

import { AppText } from '@/components/ui';
import { space } from '@/theme';

const MARK = { light: require('@/assets/images/logo-mark.png'), dark: require('@/assets/images/logo-mark-dark.png') };
const RATIO = 420 / 240;

export function LogoMark({ height = 22 }: { height?: number }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <Image
      source={MARK[scheme]}
      style={{ width: height * RATIO, height }}
      contentFit="contain"
      accessibilityLabel="Agentic Factor"
    />
  );
}

/** The mark with the name beside it. */
export function Logo({ height = 22, size = 'lg' as const }: { height?: number; size?: 'md' | 'lg' | 'xl' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessible accessibilityLabel="Agentic Factor">
      <LogoMark height={height} />
      <AppText size={size} weight="800">Agentic Factor</AppText>
    </View>
  );
}
