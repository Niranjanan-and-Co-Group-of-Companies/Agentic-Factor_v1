// The Markdown assistant replies use, parsed into blocks and inline spans — how the app draws replies:
// headings, paragraphs, bullet and numbered lists (with sub-points), quotes, code, tables and dividers.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'boldItalic'; text: string }
  | { kind: 'strike'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string };

export interface ListItem { inline: Inline[]; /** 0 for a top-level point, 1 for a sub-point… */ depth: number; /** A numbered item's number. */ n?: number }

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'quote'; inline: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][]; align: Array<'left' | 'center' | 'right'> }
  | { kind: 'rule' };

const INLINE = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|mailto:|tel:)[^)\s]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|(?<![\w*])\*[^*\s][^*]*\*(?!\w)|(?<![\w_])_[^_\s][^_]*_(?![\w_]))/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const t = m[0];
    if (m.index! > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    if (t.startsWith('***')) out.push({ kind: 'boldItalic', text: t.slice(3, -3) });
    else if (t.startsWith('**') || t.startsWith('__')) out.push({ kind: 'bold', text: t.slice(2, -2) });
    else if (t.startsWith('~~')) out.push({ kind: 'strike', text: t.slice(2, -2) });
    else if (t.startsWith('`')) out.push({ kind: 'code', text: t.slice(1, -1) });
    else if (t.startsWith('[')) {
      const close = t.indexOf('](');
      out.push({ kind: 'link', text: t.slice(1, close), url: t.slice(close + 2, -1) });
    } else if (t.startsWith('http')) out.push({ kind: 'link', text: t, url: t });
    else out.push({ kind: 'italic', text: t.slice(1, -1) });
    last = m.index! + t.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** The cells of a table row: `| a | b |` → ["a", "b"] (escaped pipes stay in the cell). */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
}

const isTableRow = (line: string) => line.includes('|') && cells(line).length > 1;
const isRuling = (line: string) => {
  const parts = cells(line);
  return parts.length > 0 && parts.every(c => /^:?-{2,}:?$/.test(c)) && (parts.length > 1 || line.trim().startsWith('|'));
};

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', inline: parseInline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) code.push(lines[i]);
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    if (!trimmed) { flush(); continue; }
    // A table: a header row, then a ruling (|---|:---:|), then rows.
    if (isTableRow(line) && i + 1 < lines.length && isRuling(lines[i + 1])) {
      flush();
      const header = cells(line);
      const align = cells(lines[i + 1]).map(c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left') as 'left' | 'center' | 'right');
      const rows: Inline[][][] = [];
      for (i += 2; i < lines.length && lines[i].trim() && isTableRow(lines[i]); i++) {
        const row = cells(lines[i]);
        rows.push(header.map((_, c) => parseInline(row[c] ?? '')));
      }
      i--;
      blocks.push({ kind: 'table', header: header.map(h => parseInline(h)), rows, align });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed.replace(/\s/g, ''))) { flush(); blocks.push({ kind: 'rule' }); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: Math.min(heading[1].length, 4) as 1 | 2 | 3 | 4, inline: parseInline(heading[2].replace(/\s#+$/, '')) });
      continue;
    }
    const item = /^(\s*)(?:([-*+•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const indent = item[1].replace(/\t/g, '    ').length;
      const entry: ListItem = { inline: parseInline(item[4]), depth: Math.min(3, Math.floor(indent / 2)), ...(item[3] ? { n: Number(item[3]) } : {}) };
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === 'list') prev.items.push(entry);
      else blocks.push({ kind: 'list', items: [entry] });
      continue;
    }
    if (trimmed.startsWith('>')) {
      flush();
      const quote = [trimmed.replace(/^>\s?/, '')];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('>')) quote.push(lines[++i].trim().replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', inline: parseInline(quote.join(' ')) });
      continue;
    }
    // A line continuing a list item (indented text under a point).
    const prev = blocks[blocks.length - 1];
    if (!para.length && prev?.kind === 'list' && /^\s{2,}\S/.test(line)) {
      const last = prev.items[prev.items.length - 1];
      last.inline = [...last.inline, { kind: 'text', text: ' ' }, ...parseInline(trimmed)];
      continue;
    }
    para.push(trimmed);
  }
  flush();
  // A sub-point sits under a point: one level deeper at most, and a list starts at the top level.
  for (const b of blocks) {
    if (b.kind !== 'list') continue;
    let depth = -1;
    for (const it of b.items) { it.depth = Math.min(it.depth, depth + 1); depth = it.depth; }
  }
  return blocks;
}

/** Removes <action>…</action> blocks (complete or still streaming) so raw JSON never shows. */
export function stripActionTags(text: string): string {
  return text.replace(/<action>[\s\S]*?<\/action>/g, '').replace(/<action>[\s\S]*$/, '').trim();
}
