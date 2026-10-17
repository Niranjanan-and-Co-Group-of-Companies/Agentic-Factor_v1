'use client';
/**
 * ConnectorLogo — the official logo of any connector, from Composio's catalog (its 1,600+ apps),
 * with no hand-kept brand lists. Apps the catalog doesn't know get a lettered tile.
 */

import { useState } from 'react';
import { useAppInfo, fallback, normSlug } from '@/components/apps/useAppInfo';

interface Props {
  id: string;
  size?: number;
}

export default function ConnectorLogo({ id, size = 32 }: Props) {
  const slug = normSlug(id || '');
  const info = useAppInfo(slug);
  const [broken, setBroken] = useState(false);
  // Until the catalog answers, show the logo service's image for the slug (right for nearly every app).
  const shown = info ?? fallback(slug);
  if (!slug || broken || (info && !info.known)) return <LetterTile name={shown.name || slug} size={size} />;

  return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size * 0.22), flexShrink: 0, overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#ffffff', border: '1px solid var(--border)',
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={shown.logo}
        alt={shown.name}
        title={shown.name}
        width={Math.round(size * 0.66)}
        height={Math.round(size * 0.66)}
        style={{ objectFit: 'contain', display: 'block' }}
        onError={() => setBroken(true)}
      />
    </div>
  );
}

// A steady colour per name, from a small palette that works in both themes.
const TILE_PALETTE = ['#2D5D86', '#2E7A55', '#6B4C7A', '#9A6106', '#B42318', '#3F6F73', '#5B5F97', '#7A5C3E'];

function LetterTile({ name, size }: { name: string; size: number }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <div title={name} style={{
      width: size, height: size, borderRadius: Math.round(size * 0.22), flexShrink: 0,
      background: TILE_PALETTE[hash % TILE_PALETTE.length], color: '#ffffff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: Math.round(size * 0.45), fontFamily: 'var(--font-sans)', userSelect: 'none',
    }}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
}
