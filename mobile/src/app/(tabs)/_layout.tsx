import { NativeTabs } from 'expo-router/native-tabs';

import { useColors } from '@/theme';

export default function TabsLayout() {
  const c = useColors();
  return (
    <NativeTabs tintColor={c.accent}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Assistant</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right.fill" md="chat" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="missions">
        <NativeTabs.Trigger.Label>Missions</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.stack.3d.up.fill" md="view_list" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle.fill" md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
