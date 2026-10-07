import { describe, it, expect, beforeAll } from 'vitest';
import { encryptToken, plaintextToken } from '../vault';

const TENANT = 'a0000000-0000-0000-0000-000000000001';

beforeAll(() => {
  process.env.JWT_SECRET = 'vitest-only-dummy-secret';
});

describe('plaintextToken', () => {
  it('decrypts rows saved with the [encrypted] marker', async () => {
    const encrypted_token = await encryptToken(TENANT, 'sk_live_abc123');
    expect(await plaintextToken(TENANT, { access_token: '[encrypted]', encrypted_token })).toBe('sk_live_abc123');
  });

  it('returns legacy plaintext rows unchanged', async () => {
    expect(await plaintextToken(TENANT, { access_token: 'sk_legacy', encrypted_token: null })).toBe('sk_legacy');
  });

  it('keeps the composio_managed marker so callers can route through Composio', async () => {
    expect(await plaintextToken(TENANT, { access_token: 'composio_managed' })).toBe('composio_managed');
  });

  it('never hands the [encrypted] marker to a caller as a key', async () => {
    expect(await plaintextToken(TENANT, { access_token: '[encrypted]', encrypted_token: 'not-valid-ciphertext' })).toBeNull();
  });

  it('cannot decrypt another tenant\'s key', async () => {
    const encrypted_token = await encryptToken(TENANT, 'sk_live_abc123');
    const other = 'b0000000-0000-0000-0000-000000000002';
    expect(await plaintextToken(other, { access_token: '[encrypted]', encrypted_token })).toBeNull();
  });

  it('handles a missing row', async () => {
    expect(await plaintextToken(TENANT, null)).toBeNull();
  });
});
