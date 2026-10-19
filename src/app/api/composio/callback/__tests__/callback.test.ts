import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const upserts: unknown[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({
      upsert: (row: unknown) => { upserts.push(row); return Promise.resolve({ error: null }); },
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [] }) }) }),
    }),
  }),
}));

import { GET } from '../route';
import { signConnectState } from '@/lib/services/connect-state';

beforeEach(() => { upserts.length = 0; vi.stubEnv('JWT_SECRET', 'test-secret'); });
afterEach(() => { vi.unstubAllEnvs(); });

const call = (query: string) => GET(new NextRequest(`https://agenticfactor.io/api/composio/callback?${query}`));

describe('GET /api/composio/callback', () => {
  it('ignores a bare account id in the address', async () => {
    const res = await call('tenantId=VICTIM&provider=gmail');
    expect(await res.text()).toContain('expired or is not valid');
    expect(upserts).toHaveLength(0);
  });
  it('connects the account named in a signed ticket', async () => {
    const res = await call(`state=${encodeURIComponent(signConnectState({ tenantId: 'T1', provider: 'gmail' }))}`);
    expect(await res.text()).toContain('Connected!');
    expect(upserts).toEqual([expect.objectContaining({ tenant_id: 'T1', provider: 'gmail' })]);
  });
  it('sends the app back to itself', async () => {
    const res = await call(`state=${encodeURIComponent(signConnectState({ tenantId: 'T1', provider: 'gmail', returnTo: 'agenticfactor://connected' }))}`);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('agenticfactor://connected?status=connected&provider=gmail');
  });
  it('never runs a script passed in the error', async () => {
    const html = await (await call(`error=${encodeURIComponent("');alert(1);//</script><script>alert(2)</script>")}`)).text();
    expect(html).not.toContain('<script>alert(2)');
    expect(html).not.toMatch(/payload: '\);alert/);
    expect(html).toContain('\\u003c/script>');
  });
});
