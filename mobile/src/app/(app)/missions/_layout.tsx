import { Stack } from 'expo-router';

import { MenuButton } from '@/components/MenuButton';
import { useColors } from '@/theme';

// A mission's chat, opened from the sidebar; ☰ brings the sidebar back.
export default function MissionsLayout() {
  const c = useColors();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, headerShadowVisible: false, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="[id]" options={{ title: '', headerLeft: () => <MenuButton /> }} />
    </Stack>
  );
}
