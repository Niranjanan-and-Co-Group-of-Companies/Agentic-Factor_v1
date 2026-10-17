'use client';
// An app's official name, logo and description, from Composio's catalog through /api/catalog/apps.
// Every component asking within the same moment is served by one request, and answers are kept for the
// visit, so a page full of logos costs one lookup.

import { useEffect, useSyncExternalStore } from 'react';
import { appName } from '@/lib/utils/app-name';

export interface AppInfo { slug: string; name: string; logo: string; description: string; known: boolean }

const cache = new Map<string, AppInfo>();
const queued = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let version = 0;

function flush() {
  timer = null;
  const slugs = [...queued].slice(0, 40);
  slugs.forEach(s => queued.delete(s));
  if (slugs.length === 0) return;
  fetch(`/api/catalog/apps?slugs=${encodeURIComponent(slugs.join(','))}`, { credentials: 'include' })
    .then(r => (r.ok ? r.json() : null))
    .then((d: { apps?: Record<string, AppInfo> } | null) => {
      for (const s of slugs) cache.set(s, d?.apps?.[s] ?? fallback(s));
      version++;
      listeners.forEach(l => l());
    })
    .catch(() => { /* leave uncached; the next mount asks again */ });
  if (queued.size > 0) timer = setTimeout(flush, 30);
}

function request(slug: string) {
  if (cache.has(slug) || queued.has(slug)) return;
  queued.add(slug);
  if (!timer) timer = setTimeout(flush, 30);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export const normSlug = (slug: string) => slug.trim().toLowerCase();
export const fallback = (slug: string): AppInfo => ({ slug, name: appName(slug), logo: `https://logos.composio.dev/api/${slug}`, description: '', known: false });

/** The app's details, or null until they arrive. */
export function useAppInfo(slug: string | null | undefined): AppInfo | null {
  const s = slug ? normSlug(slug) : '';
  useEffect(() => { if (s) request(s); }, [s]);
  useSyncExternalStore(subscribe, () => version, () => 0);
  return s ? cache.get(s) ?? null : null;
}

/** The app's name right now, for plain text (already-fetched official name, else a readable one). */
export function appNameNow(slug: string): string {
  const s = normSlug(slug);
  return cache.get(s)?.name ?? appName(s);
}
