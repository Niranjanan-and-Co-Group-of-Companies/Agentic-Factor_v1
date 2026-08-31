'use client';

import React from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────

export const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|svg|avif)(\?[^\s]*)?$/i;
export const VIDEO_URL_RE = /\.(mp4|webm|ogg|mov|m4v)(\?[^\s]*)?$/i;
export const FILE_URL_RE  = /\.(pdf|docx?|xlsx?|pptx?|csv|zip|txt|json|xml)(\?[^\s]*)?$/i;

const FILE_ICONS: Record<string, string> = {
  pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
  ppt: '📋', pptx: '📋', csv: '📊', zip: '🗜️', txt: '📄', json: '🔧', xml: '🔧',
};

// ── Sub-components ────────────────────────────────────────────────────────────

export function FileDownloadCard({ url }: { url: string }) {
  const filename = decodeURIComponent(url.split('?')[0].split('/').pop() ?? 'file');
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const icon = FILE_ICONS[ext] ?? '📎';
  return (
    <a href={url} download target="_blank" rel="noreferrer"
       style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRadius: 8, textDecoration: 'none', color: 'var(--text-primary)',
                fontSize: '0.82rem', margin: '4px 0', cursor: 'pointer' }}>
      <span style={{ fontSize: '1.1rem' }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filename}</span>
      <span style={{ color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 600 }}>↓</span>
    </a>
  );
}

export function ImageGrid({ images }: { images: { url: string; alt: string }[] }) {
  const cols = images.length === 1 ? 1 : images.length <= 4 ? 2 : 3;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6, margin: '8px 0' }}>
      {images.map((img, j) => (
        <a key={j} href={img.url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt={img.alt || 'image'}
               style={{ width: '100%', borderRadius: 8, objectFit: 'cover',
                        maxHeight: 260, display: 'block', border: '1px solid var(--border)' }} />
        </a>
      ))}
    </div>
  );
}

// ── Main renderer ─────────────────────────────────────────────────────────────

export function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let listItems: string[] = [];
  let orderedList = false;
  const imgBuf: { url: string; alt: string }[] = [];
  let tableRows: string[][] = [];
  let tableHasHeader = false;

  const isTableRow = (s: string) => s.startsWith('|') && s.endsWith('|') && s.length > 2;
  const isTableSep  = (s: string) => isTableRow(s) && /^[\|\s\-:]+$/.test(s) && s.includes('-');
  const parseTableRow = (s: string): string[] => s.split('|').slice(1, -1).map(c => c.trim());

  const flushImgBuf = (key: string) => {
    if (imgBuf.length === 0) return;
    out.push(<ImageGrid key={key} images={[...imgBuf]} />);
    imgBuf.length = 0;
  };

  const flushListBuf = (key: string) => {
    if (listItems.length === 0) return;
    const Tag = orderedList ? 'ol' : 'ul';
    out.push(
      <Tag key={key} style={{ margin: '6px 0 6px 16px', padding: 0 }}>
        {listItems.map((li, j) => (
          <li key={j} style={{ marginBottom: 3, listStyleType: orderedList ? 'decimal' : 'disc' }}>{inlineText(li)}</li>
        ))}
      </Tag>
    );
    listItems = [];
  };

  const flushTable = (key: string) => {
    if (tableRows.length === 0) return;
    const prelen = imgBuf.length;
    const header = tableHasHeader ? tableRows[0] : null;
    const body   = tableHasHeader ? tableRows.slice(1) : tableRows;
    out.push(
      <div key={key} style={{ overflowX: 'auto', margin: '10px 0', borderRadius: 8, border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 360 }}>
          {header && (
            <thead>
              <tr>
                {header.map((cell, ci) => (
                  <th key={ci} style={{
                    padding: '9px 14px', textAlign: 'left', fontWeight: 700,
                    background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                    borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap',
                  }}>
                    {inlineText(cell)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: ri < body.length - 1 ? '1px solid var(--border)' : 'none' }}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{
                    padding: '8px 14px', verticalAlign: 'top',
                    color: ci === 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: ci === 0 ? 600 : 400,
                    background: ri % 2 === 1 ? 'var(--bg-secondary)' : 'transparent',
                  }}>
                    {inlineText(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    imgBuf.length = prelen;
    tableRows = [];
    tableHasHeader = false;
  };

  const flushAll = (key: string) => { flushListBuf(`${key}-l`); flushTable(`${key}-t`); flushImgBuf(`${key}-i`); };

  const inlineText = (s: string): React.ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>"']+)/g)
     .map((p, i): React.ReactNode => {
       if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
       if (p.startsWith('*') && p.endsWith('*')) return <em key={i}>{p.slice(1, -1)}</em>;
       if (p.startsWith('`') && p.endsWith('`')) return <code key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 3, padding: '1px 5px', fontSize: '0.84em', fontFamily: 'monospace' }}>{p.slice(1, -1)}</code>;
       if (p.startsWith('![')) {
         const m = p.match(/!\[([^\]]*)\]\(([^)]+)\)/);
         if (m) { if (IMAGE_URL_RE.test(m[2])) { imgBuf.push({ url: m[2], alt: m[1] }); return ''; } return <a key={i} href={m[2]} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{m[1] || m[2]}</a>; }
       }
       if (p.startsWith('[')) {
         const m = p.match(/\[([^\]]+)\]\(([^)]+)\)/);
         if (m) { if (IMAGE_URL_RE.test(m[2])) { imgBuf.push({ url: m[2], alt: m[1] }); return ''; } return <a key={i} href={m[2]} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{m[1]}</a>; }
       }
       if (p.startsWith('http')) {
         if (IMAGE_URL_RE.test(p)) { imgBuf.push({ url: p, alt: '' }); return ''; }
         return <a key={i} href={p} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline', wordBreak: 'break-all' }}>{p}</a>;
       }
       return p;
     });

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    // Table rows
    if (isTableRow(trimmed)) {
      if (tableRows.length === 0) flushAll(`pre-tbl${i}`);
      if (isTableSep(trimmed)) { if (tableRows.length === 1) tableHasHeader = true; }
      else tableRows.push(parseTableRow(trimmed));
      return;
    }
    if (tableRows.length > 0) flushTable(`tbl${i}`);

    // Headings
    const hMatch = trimmed.match(/^(#{1,3}) (.+)/);
    if (hMatch) {
      flushAll(`h${i}`);
      const level = hMatch[1].length as 1 | 2 | 3;
      const sz = ['1.15rem', '1.05rem', '0.95rem'][level - 1];
      const mg = [16, 14, 12][level - 1];
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
      out.push(<Tag key={`h${i}`} style={{ fontSize: sz, fontWeight: 700, margin: `${mg}px 0 5px` }}>{inlineText(hMatch[2])}</Tag>);
      return;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushAll(`hr${i}`);
      out.push(<hr key={`hr${i}`} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '10px 0' }} />);
      return;
    }

    // Ordered list
    const olMatch = trimmed.match(/^(\d+)\. (.+)/);
    if (olMatch) {
      flushImgBuf(`img${i}`);
      if (listItems.length > 0 && !orderedList) flushListBuf(`ul${i}`);
      orderedList = true; listItems.push(olMatch[2]); return;
    }

    // Unordered list
    if (/^[-•*] /.test(trimmed)) {
      flushImgBuf(`img${i}`);
      if (listItems.length > 0 && orderedList) flushListBuf(`ol${i}`);
      orderedList = false; listItems.push(trimmed.replace(/^[-•*] /, '')); return;
    }

    // Blank line
    if (trimmed === '') {
      flushAll(`blank${i}`);
      if (out.length > 0) out.push(<br key={`br${i}`} />);
      return;
    }

    // Regular content line
    flushListBuf(`list${i}`);

    if (/^https?:\/\/[^\s]+$/.test(trimmed)) {
      if (IMAGE_URL_RE.test(trimmed)) { imgBuf.push({ url: trimmed, alt: '' }); return; }
      if (VIDEO_URL_RE.test(trimmed)) { flushImgBuf(`img${i}`); out.push(<video key={`vid${i}`} src={trimmed} controls style={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0', display: 'block' }} />); return; }
      if (FILE_URL_RE.test(trimmed)) { flushImgBuf(`img${i}`); out.push(<FileDownloadCard key={`file${i}`} url={trimmed} />); return; }
    }

    const prevLen = imgBuf.length;
    const nodes = inlineText(trimmed);
    const newImages = imgBuf.splice(prevLen);
    const hasText = nodes.some(n => typeof n === 'string' ? (n as string).trim() !== '' : Boolean(n));

    if (!hasText && newImages.length > 0) { imgBuf.push(...newImages); return; }

    flushImgBuf(`img-pre${i}`);
    out.push(<span key={`ln${i}`} style={{ display: 'block' }}>{nodes}</span>);
    imgBuf.push(...newImages);
    flushImgBuf(`img-post${i}`);
  });

  flushAll('end');
  return out;
}
