// The browser build's tab bar (phones use the native one in _layout.tsx): a plain bar at the bottom.

import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text } from 'react-native';

import { font, space, useColors } from '@/theme';

function TabButton({ children, isFocused, onPress }: TabTriggerSlotProps) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: isFocused }} style={styles.tab}>
      <Text style={{ color: isFocused ? c.accent : c.textMuted, fontSize: font.sm, fontWeight: isFocused ? '700' : '500' }}>{children}</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      <TabList style={[styles.bar, { backgroundColor: c.bg, borderTopColor: c.border }]}>
        <TabTrigger name="index" href="/" asChild><TabButton>Assistant</TabButton></TabTrigger>
        <TabTrigger name="missions" href="/missions" asChild><TabButton>Missions</TabButton></TabTrigger>
        <TabTrigger name="account" href="/account" asChild><TabButton>Account</TabButton></TabTrigger>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space.md, minHeight: 52 },
});
