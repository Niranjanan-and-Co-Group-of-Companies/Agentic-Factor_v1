// The small Markdown subset assistant replies use, parsed into blocks and inline spans for rendering.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'bullet'; items: Inline[][] }
  | { kind: 'numbered'; items: Inline[][]; start: number }
  | { kind: 'quote'; inline: Inline[] }
  | { kind: 'code'; text: string };

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)|(?<![\w*])\*[^*\s][^*]*\*(?!\w)|(?<![\w_])_[^_\s][^_]*_(?![\w_]))/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const t = m[0];
    if (m.index! > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    if (t.startsWith('**') || t.startsWith('__')) out.push({ kind: 'bold', text: t.slice(2, -2) });
    else if (t.startsWith('`')) out.push({ kind: 'code', text: t.slice(1, -1) });
    else if (t.startsWith('[')) {
      const close = t.indexOf('](');
      out.push({ kind: 'link', text: t.slice(1, close), url: t.slice(close + 2, -1) });
    } else out.push({ kind: 'italic', text: t.slice(1, -1) });
    last = m.index! + t.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

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
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) { flush(); blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, inline: parseInline(heading[2]) }); continue; }
    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flush();
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === 'bullet') prev.items.push(parseInline(bullet[1]));
      else blocks.push({ kind: 'bullet', items: [parseInline(bullet[1])] });
      continue;
    }
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flush();
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === 'numbered') prev.items.push(parseInline(numbered[2]));
      else blocks.push({ kind: 'numbered', items: [parseInline(numbered[2])], start: Number(numbered[1]) });
      continue;
    }
    if (trimmed.startsWith('>')) { flush(); blocks.push({ kind: 'quote', inline: parseInline(trimmed.replace(/^>\s?/, '')) }); continue; }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

/** Removes <action>…</action> blocks (complete or still streaming) so raw JSON never shows. */
export function stripActionTags(text: string): string {
  return text.replace(/<action>[\s\S]*?<\/action>/g, '').replace(/<action>[\s\S]*$/, '').trim();
}
