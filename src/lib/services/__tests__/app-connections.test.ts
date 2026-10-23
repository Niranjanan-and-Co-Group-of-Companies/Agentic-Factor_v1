/* eslint-disable @typescript-eslint/no-explicit-any -- a deliberately loose stand-in for the Supabase client */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { composioConnections, syncConnections } from '../app-connections';

let rows: Array<{ tenant_id: string; provider: string }> = [];
const upserts: string[] = [];
const supabase = {
  from: (table: string) => {
    const q: any = {
      select: () => q,
      eq: (_c: string, v: string) => (table === 'tenant_permissions' ? Promise.resolve({ data: rows.filter(r => r.tenant_id === v), error: null }) : q),
      upsert: (row: { tenant_id: string; provider: string }) => { upserts.push(row.provider); rows.push(row); return Promise.resolve({ error: null }); },
      update: () => q,
    };
    return q;
  },
} as any;

// Composio's connected-accounts list, two pages
const fetchImpl = vi.fn(async (url: string) => {
  const page2 = url.includes('cursor=next');
  const body = page2
    ? { items: [{ status: 'ACTIVE', toolkit: { slug: 'gmail' } }], next_cursor: null }
    : { items: [{ status: 'ACTIVE', toolkit: { slug: 'googlesheets' } }, { status: 'EXPIRED', toolkit: { slug: 'slack' } }], next_cursor: 'next' };
  return new Response(JSON.stringify(body), { status: 200 });
}) as unknown as typeof fetch;

beforeEach(() => {
  process.env.COMPOSIO_API_KEY = 'test-key';
  rows = [{ tenant_id: 't1', provider: 'gmail' }];
  upserts.length = 0;
});

describe('connections made at Composio', () => {
  it('lists only the active ones, across pages, from the right address', async () => {
    expect(await composioConnections('t1', fetchImpl)).toEqual(['googlesheets', 'gmail']);
    const firstUrl = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(firstUrl).toContain('/api/v3.1/connected_accounts?user_ids=t1');
  });

  it('records the ones the platform missed — a connection whose last step never arrived', async () => {
    expect(await syncConnections(supabase, 't1', { force: true, fetchImpl })).toEqual(['googlesheets']);
    expect(upserts).toEqual(['googlesheets']);
  });

  it('asks Composio at most every few minutes unless told to', async () => {
    await syncConnections(supabase, 't2', { fetchImpl });
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(await syncConnections(supabase, 't2', { fetchImpl })).toEqual([]);
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
  });
});
