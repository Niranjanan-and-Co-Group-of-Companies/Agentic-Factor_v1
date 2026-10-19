import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { connectCallbackUrl, readConnectState, signConnectState } from '../connect-state';

beforeEach(() => { vi.stubEnv('JWT_SECRET', 'test-secret'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('connect tickets — the callback only trusts what our server signed', () => {
  it('reads back a ticket it signed, including a return to the app', () => {
    const t = signConnectState({ tenantId: 'T1', provider: 'gmail', returnTo: 'agenticfactor://connected' });
    expect(readConnectState(t)).toEqual({ tenantId: 'T1', provider: 'gmail', returnTo: 'agenticfactor://connected' });
  });
  it('refuses a ticket whose account was changed', () => {
    const t = signConnectState({ tenantId: 'T1', provider: 'gmail' });
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), t: 'VICTIM' })).toString('base64url');
    expect(readConnectState(`${forged}.${sig}`)).toBeNull();
  });
  it('refuses expired tickets, other secrets and junk', () => {
    const old = signConnectState({ tenantId: 'T1', provider: 'gmail' }, Date.now() - 2 * 60 * 60_000);
    expect(readConnectState(old)).toBeNull();
    const t = signConnectState({ tenantId: 'T1', provider: 'gmail' });
    vi.stubEnv('JWT_SECRET', 'another-secret');
    expect(readConnectState(t)).toBeNull();
    expect(readConnectState('not-a-ticket')).toBeNull();
    expect(readConnectState(null)).toBeNull();
  });
  it('drops a return address that is not the app', () => {
    const t = signConnectState({ tenantId: 'T1', provider: 'gmail', returnTo: 'https://evil.example' });
    expect(readConnectState(t)?.returnTo).toBeUndefined();
  });
  it('puts only the ticket in the callback address', () => {
    const url = connectCallbackUrl('https://agenticfactor.io', { tenantId: 'T1', provider: 'gmail' });
    expect(url.startsWith('https://agenticfactor.io/api/composio/callback?state=')).toBe(true);
    expect(url).not.toContain('tenantId');
  });
});
