// The app a step uses, as a small label: "Google Sheets", "Gmail".

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { appName } from '@/lib/app-name';
import { radius, space, useColors } from '@/theme';

export function ConnectorBadge({ toolkit }: { toolkit: string }) {
  const c = useColors();
  return (
    <View style={[styles.badge, { backgroundColor: c.bgSecondary, borderColor: c.border }]}>
      <AppText size="xs" weight="700" tone="secondary">{appName(toolkit)}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
});
