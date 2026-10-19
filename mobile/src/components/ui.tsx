// The app's building blocks. Text follows the phone's text-size setting; buttons are at least 44pt
// tall and labelled for screen readers.

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';

import { font, radius, space, useColors, type Colors } from '@/theme';

type Tone = 'primary' | 'secondary' | 'muted' | 'accent' | 'emerald' | 'amber' | 'rose' | 'info';

const toneColor = (c: Colors, tone: Tone) => ({
  primary: c.text, secondary: c.textSecondary, muted: c.textMuted, accent: c.accent,
  emerald: c.emerald, amber: c.amber, rose: c.rose, info: c.info,
})[tone];

export function AppText({ size = 'md', tone = 'primary', weight = '400', style, ...props }: TextProps & {
  size?: keyof typeof font; tone?: Tone; weight?: TextStyle['fontWeight'];
}) {
  const c = useColors();
  return <Text {...props} style={[{ fontSize: font[size], color: toneColor(c, tone), fontWeight: weight, lineHeight: Math.round(font[size] * 1.45) }, style]} />;
}

export function Button({ label, onPress, variant = 'primary', loading, disabled, icon, style, accessibilityHint }: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const c = useColors();
  const bg = variant === 'primary' ? c.buttonBg : 'transparent';
  const fg = variant === 'primary' ? c.buttonFg : variant === 'danger' ? c.rose : c.text;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === 'primary' ? bg : variant === 'danger' ? c.rose : c.border, opacity: off ? 0.55 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      <Text maxFontSizeMultiplier={1.6} style={{ color: fg, fontSize: font.md, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'ok' | 'error' | 'pending' }) {
  const c = useColors();
  const edge = tone === 'ok' ? c.emerald : tone === 'error' ? c.rose : tone === 'pending' ? c.borderStrong : undefined;
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, edge ? { borderLeftWidth: 3, borderLeftColor: edge } : null, style]}>
      {children}
    </View>
  );
}

export function Badge({ label, tone = 'muted' }: { label: string; tone?: Tone }) {
  const c = useColors();
  const color = toneColor(c, tone);
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text maxFontSizeMultiplier={1.4} style={{ color, fontSize: font.xs, fontWeight: '700', letterSpacing: 0.4 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: 'flex-start' },
});
