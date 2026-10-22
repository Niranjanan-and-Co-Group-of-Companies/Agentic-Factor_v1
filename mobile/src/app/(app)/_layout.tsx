// The signed-in app, laid out like Claude, ChatGPT and Gemini: the chat fills the screen and the sidebar
// (chats, missions, account) slides in from the left — or stays open beside it on tablets.

import { Drawer } from 'expo-router/drawer';
import { useWindowDimensions } from 'react-native';

import { PERMANENT_SIDEBAR_WIDTH } from '@/components/MenuButton';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useColors } from '@/theme';

export default function AppLayout() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const permanent = width >= PERMANENT_SIDEBAR_WIDTH;
  return (
    <Drawer
      drawerContent={props => <Sidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: permanent ? 'permanent' : 'front',
        drawerStyle: { width: permanent ? 300 : Math.min(320, width * 0.85), backgroundColor: c.bg, borderRightColor: c.border },
        overlayColor: 'rgba(0,0,0,0.35)',
        swipeEdgeWidth: 48,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Drawer.Screen name="index" options={{ title: 'Chat' }} />
      <Drawer.Screen name="missions" options={{ title: 'Missions' }} />
      <Drawer.Screen name="account" options={{ title: 'Account' }} />
    </Drawer>
  );
}
