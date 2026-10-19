import * as WebBrowser from 'expo-web-browser';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { parseMarkdown, type Inline } from '@/lib/markdown';
import { font, radius, space, useColors } from '@/theme';

function Spans({ inline, color }: { inline: Inline[]; color: string }) {
  const c = useColors();
  return (
    <>
      {inline.map((s, i) => {
        if (s.kind === 'bold') return <Text key={i} style={{ fontWeight: '700' }}>{s.text}</Text>;
        if (s.kind === 'italic') return <Text key={i} style={{ fontStyle: 'italic' }}>{s.text}</Text>;
        if (s.kind === 'code') return <Text key={i} style={[styles.inlineCode, { backgroundColor: c.bgSecondary }]}>{s.text}</Text>;
        if (s.kind === 'link') {
          return (
            <Text key={i} accessibilityRole="link" style={{ color: c.accent, textDecorationLine: 'underline' }} onPress={() => WebBrowser.openBrowserAsync(s.url)}>
              {s.text}
            </Text>
          );
        }
        return <Fragment key={i}>{s.text}</Fragment>;
      })}
    </>
  );
}

/** Renders an assistant reply's Markdown (headings, lists, quotes, code, bold, links). */
export function Markdown({ text, color }: { text: string; color?: string }) {
  const c = useColors();
  const ink = color ?? c.text;
  const body = { color: ink, fontSize: font.md, lineHeight: 22 };
  return (
    <View style={{ gap: space.sm }}>
      {parseMarkdown(text).map((b, i) => {
        if (b.kind === 'heading') {
          return <Text key={i} accessibilityRole="header" style={[body, { fontWeight: '700', fontSize: b.level === 1 ? font.xl : font.lg }]}><Spans inline={b.inline} color={ink} /></Text>;
        }
        if (b.kind === 'bullet' || b.kind === 'numbered') {
          return (
            <View key={i} style={{ gap: space.xs }}>
              {b.items.map((item, j) => (
                <View key={j} style={styles.listRow}>
                  <Text style={[body, styles.marker]}>{b.kind === 'bullet' ? '•' : `${b.start + j}.`}</Text>
                  <Text style={[body, { flex: 1 }]}><Spans inline={item} color={ink} /></Text>
                </View>
              ))}
            </View>
          );
        }
        if (b.kind === 'quote') {
          return <Text key={i} style={[body, styles.quote, { borderLeftColor: c.borderStrong, color: c.textSecondary }]}><Spans inline={b.inline} color={ink} /></Text>;
        }
        if (b.kind === 'code') {
          return <Text key={i} selectable style={[styles.codeBlock, { backgroundColor: c.bgSecondary, color: ink }]}>{b.text}</Text>;
        }
        return <Text key={i} selectable style={body}><Spans inline={b.inline} color={ink} /></Text>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  inlineCode: { fontFamily: 'Menlo', fontSize: font.sm, paddingHorizontal: 3, borderRadius: 4 },
  listRow: { flexDirection: 'row', gap: space.sm },
  marker: { minWidth: 18 },
  quote: { borderLeftWidth: 3, paddingLeft: space.md },
  codeBlock: { fontFamily: 'Menlo', fontSize: font.sm, padding: space.md, borderRadius: radius.sm },
});
