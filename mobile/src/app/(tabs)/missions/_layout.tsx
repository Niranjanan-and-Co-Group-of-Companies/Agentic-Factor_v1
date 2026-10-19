import { Stack } from 'expo-router';

import { useColors } from '@/theme';

export default function MissionsLayout() {
  const c = useColors();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, headerShadowVisible: false, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="index" options={{ title: 'Missions', headerLargeTitle: true }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}
