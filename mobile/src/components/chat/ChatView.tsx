// A chat: the conversation (newest at the bottom, scrolling up), replies streaming in, tool progress,
// cards, and the message box that stays above the keyboard.

import { useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isEntry, type ChatItem } from '@/lib/chat';
import { font, maxContentWidth, radius, space, useColors } from '@/theme';

import { Markdown } from '../Markdown';
import { AppText } from '../ui';

export function ChatView({ items, loading, sending, onSend, renderCard, placeholder, empty, header, alert, keyboardOffset = 0 }: {
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
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const data = [...items].reverse();

  const submit = () => {
    const t = text.trim();
    if (!t || sending) return;
    setText('');
    onSend(t);
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
          renderItem={({ item }) => <Row item={item} card={renderCard(item)} />}
        />
      )}
      <View style={[styles.composer, { borderTopColor: c.border, backgroundColor: c.bg, paddingBottom: Math.max(insets.bottom, space.sm) }]}>
        <View style={[styles.inputWrap, { borderColor: c.border, backgroundColor: c.input }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={c.textMuted}
            style={[styles.input, { color: c.text }]}
            multiline
            maxLength={8000}
            accessibilityLabel="Message"
            submitBehavior="newline"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !text.trim() || sending }}
            disabled={!text.trim() || sending}
            onPress={submit}
            hitSlop={8}
            style={({ pressed }) => [styles.send, { backgroundColor: text.trim() && !sending ? c.buttonBg : c.border, opacity: pressed ? 0.8 : 1 }]}
          >
            {sending ? <ActivityIndicator color={c.buttonFg} size="small" /> : <AppText weight="700" style={{ color: c.buttonFg }} maxFontSizeMultiplier={1.3}>↑</AppText>}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Row({ item, card }: { item: ChatItem; card: ReactNode }) {
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

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg },
  list: { padding: space.lg, gap: space.md, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  row: { gap: space.sm },
  mine: { alignItems: 'flex-end' },
  theirs: { alignItems: 'flex-start' },
  bubble: { maxWidth: '88%', borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
  alert: { borderWidth: 1, borderRadius: radius.md, padding: space.md, alignSelf: 'stretch' },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingTop: space.sm, alignItems: 'center' },
  inputWrap: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderRadius: radius.xl, paddingLeft: space.md, paddingRight: 6, paddingVertical: 6, width: '100%', maxWidth: maxContentWidth },
  input: { flex: 1, fontSize: font.md, maxHeight: 140, paddingTop: 6, paddingBottom: 6 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
