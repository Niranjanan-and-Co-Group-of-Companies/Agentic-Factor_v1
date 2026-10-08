import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import { mintSandboxLLMToken, verifySandboxLLMToken } from '../sandbox-llm-token';

const SECRET = 'vitest-only-dummy-secret';
const claims = { tenantId: 'a0000000-0000-0000-0000-000000000001', missionId: 'm-1', agentRole: 'Report Writer' };

beforeAll(() => { process.env.JWT_SECRET = SECRET; });

describe('sandbox LLM token', () => {
  it('round-trips its claims', async () => {
    const token = await mintSandboxLLMToken(claims);
    const out = await verifySandboxLLMToken(token);
    expect(out).toMatchObject(claims);
    expect(out?.tokenId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('has no sub claim, so the tenant-session JWT path can never accept it', async () => {
    const token = await mintSandboxLLMToken(claims);
    expect(decodeJwt(token).sub).toBeUndefined();
    // extractTenantContext verifies JWT_SECRET-signed tokens with the raw secret; the derived key must not verify.
    await expect(jwtVerify(token, new TextEncoder().encode(SECRET))).rejects.toThrow();
  });

  it('rejects a tenant-session style token signed with the raw secret', async () => {
    const session = await new SignJWT({ tid: claims.tenantId, scope: 'sandbox_llm' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(claims.tenantId).setJti('x').setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifySandboxLLMToken(session)).toBeNull();
  });

  it('rejects a token with the wrong scope or a sub claim even if signed with the derived key', async () => {
    const key = new TextEncoder().encode(`${SECRET}:sandbox-llm-v1`);
    const wrongScope = await new SignJWT({ tid: claims.tenantId, scope: 'admin' })
      .setProtectedHeader({ alg: 'HS256' }).setJti('y').setExpirationTime('5m').sign(key);
    const withSub = await new SignJWT({ tid: claims.tenantId, scope: 'sandbox_llm' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(claims.tenantId).setJti('z').setExpirationTime('5m').sign(key);
    expect(await verifySandboxLLMToken(wrongScope)).toBeNull();
    expect(await verifySandboxLLMToken(withSub)).toBeNull();
  });

  it('rejects expired and garbage tokens', async () => {
    const expired = await mintSandboxLLMToken(claims, -10);
    expect(await verifySandboxLLMToken(expired)).toBeNull();
    expect(await verifySandboxLLMToken('not-a-jwt')).toBeNull();
  });
});
