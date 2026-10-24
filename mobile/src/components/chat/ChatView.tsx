// A chat: the conversation (newest at the bottom, scrolling up), replies streaming in, tool progress,
// cards, copy and read-aloud buttons, and the message box that stays above the keyboard.

import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

import { isEntry, type ChatItem } from '@/lib/chat';
import { useSpeech } from '@/lib/useSpeech';
import { maxContentWidth, radius, space, useColors } from '@/theme';

import { Icon, icons } from '../Icon';
import { Markdown } from '../Markdown';
import { AppText } from '../ui';
import { Composer, type LatestReply } from './Composer';

export function ChatView({ items, loading, sending, onSend, renderCard, placeholder, empty, header, alert, keyboardOffset = 0, missionId }: {
  items: ChatItem[];
  loading: boolean;
  sending: boolean;
  onSend: (text: string) => void;
  /** Draws an item's card (action, run, entry); null when it has none. */
  renderCard: (item: ChatItem) => ReactNode;
  placeholder: string;
  empty?: ReactNode;
  header?: ReactNode;
  alert?: string | null;
  keyboardOffset?: number;
  /** A mission's chat: files shared here belong to the mission. */
  missionId?: string;
}) {
  const c = useColors();
  const speech = useSpeech();
  const data = [...items].reverse();
  const last = items[items.length - 1];
  const latest = useMemo<LatestReply | null>(() => (last?.role === 'assistant'
    ? { key: last.key, id: last.id, text: last.content, done: !last.streaming && !last.agentRunning, needsTap: !!last.action && !isEntry(last.action) && !last.applied }
    : null), [last]);

  const listen = (item: ChatItem) => {
    const voice = speech.toggle(item.key, item.content);
    void voice?.done.then(how => {
      if (how === 'failed') Alert.alert('Couldn’t read this aloud', 'Check your connection and try again.');
    });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={keyboardOffset}>
      {header}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.textMuted} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          {alert ? <View style={[styles.alert, { backgroundColor: c.amberBg, borderColor: c.amber }]}><AppText>{alert}</AppText></View> : null}
          {empty}
        </View>
      ) : (
        <FlatList
          inverted
          data={data}
          keyExtractor={i => i.key}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Row
              item={item}
              card={renderCard(item)}
              speaking={speech.speaking?.key === item.key ? (speech.speaking.playing ? 'playing' : 'preparing') : null}
              onListen={Platform.OS === 'web' ? undefined : () => listen(item)}
            />
          )}
        />
      )}
      <Composer placeholder={placeholder} sending={sending} onSend={onSend} latest={latest} speech={speech} missionId={missionId} />
    </KeyboardAvoidingView>
  );
}

function Row({ item, card, speaking, onListen }: { item: ChatItem; card: ReactNode; speaking: 'preparing' | 'playing' | null; onListen?: () => void }) {
  const c = useColors();
  const mine = item.role === 'user';
  const showText = !!item.content && !isEntry(item.action);
  return (
    <View style={[styles.row, mine ? styles.mine : styles.theirs]}>
      {showText ? (
        <View style={[styles.bubble, mine ? { backgroundColor: c.userBubble } : { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}>
          {mine
            ? <AppText style={{ color: c.userBubbleText }} selectable>{item.content}</AppText>
            : <Markdown text={item.content} />}
        </View>
      ) : null}
      {showText && !item.streaming ? (
        <View style={[styles.actions, mine && styles.actionsMine]}>
          <CopyButton text={item.content} />
          {!mine && onListen ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={speaking === 'preparing' ? 'Preparing to read aloud — tap to cancel' : speaking ? 'Stop reading aloud' : 'Read aloud'}
              onPress={onListen}
              hitSlop={10}
              style={({ pressed }) => [styles.action, styles.listen, { opacity: pressed ? 0.5 : 1 }]}
            >
              {speaking === 'preparing'
                ? <ActivityIndicator size="small" color={c.textMuted} style={{ transform: [{ scale: 0.7 }] }} />
                : speaking
                  ? <><Icon name={icons.stop} size={12} color={c.text} /><AppText size="xs" weight="700">Stop</AppText></>
                  : <Icon name={icons.speaker} size={15} color={c.textMuted} />}
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {item.streaming && !item.content && !item.tools?.length ? (
        <View style={[styles.bubble, { backgroundColor: c.card, borderColor: c.border, borderWidth: 1 }]}>
          <ActivityIndicator color={c.textMuted} accessibilityLabel="Writing a reply" />
        </View>
      ) : null}
      {item.tools?.length ? (
        <View style={{ gap: 4, alignSelf: 'stretch' }}>
          {item.tools.map(t => (
            <AppText key={t.name} size="sm" tone={t.status === 'error' ? 'rose' : t.status === 'done' ? 'muted' : 'secondary'}>
              {t.status === 'running' ? '⋯ ' : t.status === 'done' ? '✓ ' : '! '}{t.status === 'done' && t.summary ? t.summary : t.label}
            </AppText>
          ))}
        </View>
      ) : null}
      {item.agentRunning && !item.tools?.length ? <AppText size="sm" tone="muted">Agent is working…</AppText> : null}
      {card ? <View style={{ alignSelf: 'stretch' }}>{card}</View> : null}
    </View>
  );
}

/** Copies a message (its Markdown, which pastes well into notes, docs and email); a tick says it worked. */
function CopyButton({ text }: { text: string }) {
  const c = useColors();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    await Clipboard.setStringAsync(text);
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    setCopied(true);
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Copied' : 'Copy'}
      onPress={() => void copy()}
      hitSlop={10}
      style={({ pressed }) => [styles.action, { opacity: pressed ? 0.5 : 1 }]}
    >
      <Icon name={copied ? icons.check : icons.copy} size={15} color={copied ? c.emerald : c.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg },
  list: { padding: space.lg, gap: space.md, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  row: { gap: space.sm },
  mine: { alignItems: 'flex-end' },
  theirs: { alignItems: 'flex-start' },
  bubble: { maxWidth: '88%', borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
  alert: { borderWidth: 1, borderRadius: radius.md, padding: space.md, alignSelf: 'stretch' },
  actions: { flexDirection: 'row', gap: space.md, marginTop: -2, paddingHorizontal: 4 },
  actionsMine: { justifyContent: 'flex-end' },
  action: { padding: 2 },
  listen: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 22, minHeight: 22 },
});
