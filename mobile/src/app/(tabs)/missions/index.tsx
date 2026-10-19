import type { MissionListItem } from '@contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { maxContentWidth, radius, space, useColors } from '@/theme';

const STATUS_TONE: Record<string, 'emerald' | 'amber' | 'rose' | 'muted' | 'info'> = {
  active: 'emerald', running: 'info', paused: 'amber', failed: 'rose', draft: 'muted', completed: 'emerald',
};

export default function Missions() {
  const c = useColors();
  const [missions, setMissions] = useState<MissionListItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { missions: list } = await api<{ missions: MissionListItem[] }>('/api/missions');
      setMissions(list ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setMissions(prev => prev ?? []);
    }
  }, []);

  // Fresh every time the tab is opened (a mission built in the Assistant shows up straight away).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (missions === null) return <View style={[styles.center, { backgroundColor: c.bg }]}><ActivityIndicator color={c.textMuted} /></View>;

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.list}
      data={missions}
      keyExtractor={m => m.id}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={c.textMuted} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={error ? <AppText tone="rose">{error}</AppText> : undefined}
      ListEmptyComponent={
        <View style={{ gap: space.md, paddingVertical: space.xxl, alignItems: 'center' }}>
          <AppText weight="700">No missions yet</AppText>
          <AppText tone="secondary" style={{ textAlign: 'center' }}>Ask the Assistant to build one — describe the task in your own words.</AppText>
          <Button label="Open the Assistant" onPress={() => router.navigate('/')} />
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.title}, ${item.status}`}
          onPress={() => router.push(`/missions/${item.id}`)}
          style={({ pressed }) => [styles.row, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <AppText weight="600" numberOfLines={2}>{item.title}</AppText>
            {item.description ? <AppText size="sm" tone="muted" numberOfLines={2}>{item.description}</AppText> : null}
          </View>
          <Badge label={item.status} tone={STATUS_TONE[item.status] ?? 'muted'} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: space.lg, gap: space.sm, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderWidth: 1, borderRadius: radius.lg, minHeight: 64 },
});
