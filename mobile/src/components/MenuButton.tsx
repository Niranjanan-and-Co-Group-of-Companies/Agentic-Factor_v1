// ☰ — opens the sidebar. A dot shows when a mission is waiting for the customer's approval.

import { useNavigation } from 'expo-router';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon, icons } from '@/components/Icon';
import { useActiveRuns } from '@/lib/useActiveRuns';
import { useColors } from '@/theme';

/** The sidebar stays open beside the content from this width (tablets, landscape). */
export const PERMANENT_SIDEBAR_WIDTH = 900;

export function MenuButton() {
  const c = useColors();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const waiting = Object.values(useActiveRuns()).includes('approval');
  if (width >= PERMANENT_SIDEBAR_WIDTH) return null; // the sidebar is always there
  return (
    <Pressable
      onPress={() => navigation.dispatch({ type: 'OPEN_DRAWER' })}
      accessibilityRole="button"
      accessibilityLabel={waiting ? 'Open menu — something is waiting for your approval' : 'Open menu'}
      hitSlop={8}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon name={icons.menu} color={c.text} />
      {waiting ? <View style={[styles.dot, { backgroundColor: c.amber, borderColor: c.bg }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 9, right: 8, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
});
