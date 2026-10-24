import * as WebBrowser from 'expo-web-browser';
import { Fragment } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { parseMarkdown, type Inline } from '@/lib/markdown';
import { font, radius, space, useColors } from '@/theme';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

function Spans({ inline }: { inline: Inline[] }) {
  const c = useColors();
  return (
    <>
      {inline.map((s, i) => {
        if (s.kind === 'bold') return <Text key={i} style={{ fontWeight: '700' }}>{s.text}</Text>;
        if (s.kind === 'italic') return <Text key={i} style={{ fontStyle: 'italic' }}>{s.text}</Text>;
        if (s.kind === 'boldItalic') return <Text key={i} style={{ fontWeight: '700', fontStyle: 'italic' }}>{s.text}</Text>;
        if (s.kind === 'strike') return <Text key={i} style={{ textDecorationLine: 'line-through' }}>{s.text}</Text>;
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

/** A table: scrolls sideways when it is wider than the bubble; columns size to their longest cell. */
function Table({ header, rows, align, body }: { header: Inline[][]; rows: Inline[][][]; align: ('left' | 'center' | 'right')[]; body: TextStyle }) {
  const c = useColors();
  const cellText = (inline: Inline[]) => inline.map(s => s.text).join('');
  // Width from the longest cell (about 7.5 points a character), between 90 and 240 points.
  const widths = header.map((h, col) => {
    const longest = Math.max(cellText(h).length, ...rows.map(r => cellText(r[col] ?? []).length));
    return Math.min(240, Math.max(90, longest * 7.5 + space.md * 2));
  });
  const cell = (inline: Inline[], col: number, head: boolean) => (
    <View key={col} style={[styles.cell, { width: widths[col], borderColor: c.border }, head && { backgroundColor: c.bgSecondary }]}>
      <Text selectable style={[body, { fontSize: font.sm, lineHeight: 19, textAlign: align[col] ?? 'left' }, head && { fontWeight: '700' }]}>
        <Spans inline={inline} />
      </Text>
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled style={{ alignSelf: 'stretch' }} contentContainerStyle={{ flexGrow: 0 }}>
      <View accessibilityRole="none" style={[styles.table, { borderColor: c.border }]}>
        <View style={styles.row}>{header.map((h, col) => cell(h, col, true))}</View>
        {rows.map((r, i) => <View key={i} style={styles.row}>{header.map((_, col) => cell(r[col] ?? [], col, false))}</View>)}
      </View>
    </ScrollView>
  );
}

/** Renders an assistant reply's Markdown: headings, lists, quotes, code, tables, dividers, bold, links. */
export function Markdown({ text, color }: { text: string; color?: string }) {
  const c = useColors();
  const ink = color ?? c.text;
  const body = { color: ink, fontSize: font.md, lineHeight: 22 };
  return (
    <View style={{ gap: space.sm }}>
      {parseMarkdown(text).map((b, i) => {
        if (b.kind === 'heading') {
          const size = b.level === 1 ? font.xl : b.level === 2 ? font.lg : font.md;
          return <Text key={i} accessibilityRole="header" style={[body, { fontWeight: '700', fontSize: size, lineHeight: Math.round(size * 1.35) }]}><Spans inline={b.inline} /></Text>;
        }
        if (b.kind === 'list') {
          // Numbers continue per level; sub-points use a hollow bullet.
          const counters: number[] = [];
          return (
            <View key={i} style={{ gap: space.xs }}>
              {b.items.map((item, j) => {
                counters.length = item.depth + 1;
                // Counted from the first number ("1. 1. 1." in Markdown still reads 1, 2, 3).
                counters[item.depth] = counters[item.depth] === undefined ? item.n ?? 1 : counters[item.depth] + 1;
                const marker = item.n !== undefined ? `${counters[item.depth]}.` : item.depth === 0 ? '•' : '◦';
                return (
                  <View key={j} style={[styles.listRow, { paddingLeft: item.depth * 18 }]}>
                    <Text style={[body, styles.marker]}>{marker}</Text>
                    <Text selectable style={[body, { flex: 1 }]}><Spans inline={item.inline} /></Text>
                  </View>
                );
              })}
            </View>
          );
        }
        if (b.kind === 'quote') {
          return <Text key={i} selectable style={[body, styles.quote, { borderLeftColor: c.borderStrong, color: c.textSecondary }]}><Spans inline={b.inline} /></Text>;
        }
        if (b.kind === 'code') {
          return (
            <ScrollView key={i} horizontal style={[styles.codeBlock, { backgroundColor: c.bgSecondary }]}>
              <Text selectable style={{ fontFamily: mono, fontSize: font.sm, color: ink }}>{b.text}</Text>
            </ScrollView>
          );
        }
        if (b.kind === 'table') return <Table key={i} header={b.header} rows={b.rows} align={b.align} body={body} />;
        if (b.kind === 'rule') return <View key={i} style={[styles.rule, { backgroundColor: c.border }]} />;
        return <Text key={i} selectable style={body}><Spans inline={b.inline} /></Text>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  inlineCode: { fontFamily: mono, fontSize: font.sm, paddingHorizontal: 3, borderRadius: 4 },
  listRow: { flexDirection: 'row', gap: space.sm },
  marker: { minWidth: 18 },
  quote: { borderLeftWidth: 3, paddingLeft: space.md },
  codeBlock: { padding: space.md, borderRadius: radius.sm },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  cell: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
});
