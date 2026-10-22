// The sidebar, as in Claude, ChatGPT and Gemini: New chat, then Chats (one-time conversations, by date)
// or Missions (automations) with one switch and a search, and the account with its credits at the
// bottom. Missions running or waiting on the customer are counted on the switch, so nothing is hidden.

import type { ChatSession, MissionListItem, StoreBillingStatus } from '@contracts';
import { router } from 'expo-router';
import { useDrawerStatus, type DrawerContentComponentProps } from 'expo-router/drawer';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, icons } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { AppText } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useActiveChat, useChatsVersion } from '@/lib/chat-store';
import { useActiveRuns } from '@/lib/useActiveRuns';
import { font, radius, space, useColors } from '@/theme';

type Tab = 'chats' | 'missions';

function byDate(chats: ChatSession[]): [string, ChatSession[]][] {
  const groups: Record<string, ChatSession[]> = {};
  const now = Date.now();
  for (const chat of chats) {
    const days = Math.floor((now - new Date(chat.updated_at).getTime()) / 86_400_000);
    const key = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days <= 7 ? 'This week' : 'Older';
    (groups[key] ??= []).push(chat);
  }
  return ['Today', 'Yesterday', 'This week', 'Older'].filter(k => groups[k]).map(k => [k, groups[k]]);
}

export function Sidebar({ navigation, state }: DrawerContentComponentProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const open = useDrawerStatus() === 'open';
  const activeChat = useActiveChat();
  const chatsVersion = useChatsVersion();
  const activeRuns = useActiveRuns();
  const [tab, setTab] = useState<Tab>('chats');
  const [query, setQuery] = useState('');
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [billing, setBilling] = useState<StoreBillingStatus | null>(null);

  // Fresh lists each time the sidebar opens, and when a chat is created or answered.
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    api<{ sessions: ChatSession[] }>('/api/command-chat/sessions').then(r => { if (!stopped) setChats(r.sessions ?? []); }).catch(() => {});
    api<{ missions: MissionListItem[] }>('/api/missions').then(r => { if (!stopped) setMissions(r.missions ?? []); }).catch(() => {});
    api<StoreBillingStatus>('/api/billing/store').then(r => { if (!stopped) setBilling(r); }).catch(() => {});
    return () => { stopped = true; };
  }, [open, chatsVersion]);

  // The open screen: a mission's chat highlights the mission, the Command Center its chat.
  const route = state.routes[state.index];
  const nested = route.state?.routes?.[route.state.index ?? 0];
  const activeMission = route.name === 'missions' ? (nested?.params as { id?: string } | undefined)?.id : undefined;
  const onChat = route.name === 'index';
  const needYou = Object.keys(activeRuns).length;

  const q = query.trim().toLowerCase();
  const shownChats = useMemo(() => (q ? chats.filter(x => (x.title ?? '').toLowerCase().includes(q)) : chats), [chats, q]);
  const shownMissions = useMemo(() => (q ? missions.filter(m => m.title.toLowerCase().includes(q)) : missions), [missions, q]);

  const go = (path: Parameters<typeof router.navigate>[0]) => {
    router.navigate(path);
    navigation.closeDrawer();
  };

  const deleteChat = (chat: ChatSession) => {
    Alert.alert('Delete this chat?', chat.title ?? '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await api('/api/command-chat/sessions', { method: 'DELETE', body: { sessionId: chat.id } }).catch(() => {});
          setChats(prev => prev.filter(x => x.id !== chat.id));
          if (chat.id === activeChat) router.navigate({ pathname: '/', params: { fresh: String(Date.now()) } });
        },
      },
    ]);
  };

  const row = (active: boolean) => [styles.row, active && { backgroundColor: c.bgSecondary }];
  const credits = billing ? billing.credits.toLocaleString() : null;
  const plan = billing ? `${billing.plan[0].toUpperCase()}${billing.plan.slice(1)}${billing.isTrial ? ' trial' : ''}` : '';

  return (
    <View style={[styles.wrap, { backgroundColor: c.bg, paddingTop: insets.top + space.sm }]}>
      <View style={styles.top}>
        <Logo height={18} size="md" />
        <Pressable
          onPress={() => go({ pathname: '/', params: { fresh: String(Date.now()) } })}
          accessibilityRole="button"
          style={({ pressed }) => [styles.newChat, { backgroundColor: c.buttonBg, opacity: pressed ? 0.85 : 1 }]}
        >
          <Icon name={icons.newChat} size={17} color={c.buttonFg} />
          <AppText weight="700" style={{ color: c.buttonFg }}>New chat</AppText>
        </Pressable>

        <View accessibilityRole="tablist" style={[styles.switch, { backgroundColor: c.bgSecondary, borderColor: c.border }]}>
          {(['chats', 'missions'] as const).map(t => (
            <Pressable
              key={t}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t }}
              onPress={() => { setTab(t); setQuery(''); }}
              style={[styles.switchItem, tab === t && { backgroundColor: c.card }]}
            >
              <AppText size="sm" weight="700" tone={tab === t ? 'primary' : 'muted'}>{t === 'chats' ? 'Chats' : 'Missions'}</AppText>
              {t === 'missions' && needYou > 0 ? (
                <View style={[styles.count, { backgroundColor: c.amber }]} accessibilityLabel={`${needYou} running or waiting for you`}>
                  <AppText size="xs" weight="800" style={{ color: c.bg }}>{needYou}</AppText>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>

        <View style={[styles.search, { backgroundColor: c.input, borderColor: c.border }]}>
          <Icon name={icons.search} size={15} color={c.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={tab === 'chats' ? 'Search chats' : 'Search missions'}
            placeholderTextColor={c.textMuted}
            style={[styles.searchInput, { color: c.text }]}
            accessibilityLabel={tab === 'chats' ? 'Search chats' : 'Search missions'}
            returnKeyType="search"
          />
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.sm, paddingBottom: space.md }} keyboardShouldPersistTaps="handled">
        {tab === 'chats' ? (
          shownChats.length > 0 ? byDate(shownChats).map(([label, group]) => (
            <View key={label}>
              <AppText size="xs" weight="700" tone="muted" style={styles.section}>{label.toUpperCase()}</AppText>
              {group.map(chat => (
                <Pressable
                  key={chat.id}
                  onPress={() => go({ pathname: '/', params: { chat: chat.id } })}
                  onLongPress={() => deleteChat(chat)}
                  accessibilityRole="button"
                  accessibilityHint="Opens this chat. Press and hold to delete it."
                  style={({ pressed }) => [...row(onChat && chat.id === activeChat), pressed && { opacity: 0.7 }]}
                >
                  <AppText numberOfLines={1} style={{ flex: 1 }} weight={onChat && chat.id === activeChat ? '700' : '400'}>{chat.title || 'New chat'}</AppText>
                </Pressable>
              ))}
            </View>
          )) : (
            <AppText size="sm" tone="muted" style={styles.empty}>{q ? 'No chats match.' : 'Your conversations will appear here.'}</AppText>
          )
        ) : shownMissions.length > 0 ? (
          <>
            <AppText size="xs" weight="700" tone="muted" style={styles.section}>MISSIONS</AppText>
            {shownMissions.map(m => {
              const run = activeRuns[m.id];
              return (
                <Pressable
                  key={m.id}
                  onPress={() => go(`/missions/${m.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.title}${run === 'approval' ? ', waiting for your approval' : run === 'running' ? ', running now' : ''}`}
                  style={({ pressed }) => [...row(m.id === activeMission), pressed && { opacity: 0.7 }]}
                >
                  <AppText numberOfLines={1} style={{ flex: 1 }} weight={m.id === activeMission ? '700' : '400'}>{m.title}</AppText>
                  {run ? <View style={[styles.runDot, { backgroundColor: run === 'approval' ? c.amber : c.emerald }]} /> : null}
                </Pressable>
              );
            })}
          </>
        ) : (
          <AppText size="sm" tone="muted" style={styles.empty}>{q ? 'No missions match.' : 'No missions yet. Ask for something to happen regularly and it becomes one.'}</AppText>
        )}
      </ScrollView>

      <Pressable
        onPress={() => go('/account')}
        accessibilityRole="button"
        accessibilityLabel={`Account${credits ? `, ${credits} credits` : ''}`}
        style={({ pressed }) => [styles.account, { borderTopColor: c.border, paddingBottom: insets.bottom + space.sm, opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={[styles.avatar, { backgroundColor: c.bgSecondary, borderColor: c.border }]}>
          <AppText weight="800">{(session?.user.email ?? '?')[0].toUpperCase()}</AppText>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText numberOfLines={1} weight="600">{session?.user.email ?? 'Account'}</AppText>
          <AppText size="xs" tone="muted">{credits ? `${credits} credits · ${plan}` : 'Account and credits'}</AppText>
        </View>
        <Icon name={icons.chevron} size={14} color={c.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  top: { paddingHorizontal: space.md, gap: space.md, paddingBottom: space.sm },
  newChat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 44, borderRadius: radius.md },
  switch: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, padding: 3, gap: 3 },
  switchItem: { flex: 1, minHeight: 36, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  count: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.sm, minHeight: 40 },
  searchInput: { flex: 1, fontSize: font.md, paddingVertical: 8 },
  section: { paddingHorizontal: space.sm, paddingTop: space.md, paddingBottom: space.xs, letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.sm, borderRadius: radius.md },
  runDot: { width: 8, height: 8, borderRadius: 4 },
  empty: { padding: space.lg, textAlign: 'center' },
  account: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  avatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
