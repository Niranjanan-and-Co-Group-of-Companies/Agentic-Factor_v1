'use client';
// App names and descriptions from Composio's catalog, for any app — no hand-kept lists.

import { appName } from '@/lib/utils/app-name';
import { useAppInfo } from './useAppInfo';

/** The app's official name ("Zoho Books"); a readable name from the slug until it arrives. */
export function AppName({ slug }: { slug: string }) {
  const info = useAppInfo(slug);
  return <>{info?.name ?? appName(slug)}</>;
}

/** The app's official description, or `fallback` when the catalog has none. */
export function AppDescription({ slug, fallback }: { slug: string; fallback?: string }) {
  const info = useAppInfo(slug);
  return <>{info?.description || fallback || ''}</>;
}
