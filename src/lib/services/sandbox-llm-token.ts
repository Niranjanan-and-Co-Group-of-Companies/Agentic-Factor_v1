import { SignJWT, jwtVerify } from 'jose';

// Run-scoped credential that lets sandboxed agent code call /api/sandbox/llm.
// Agent scripts are LLM-written and may read untrusted web content, so this token must not work
// anywhere else: it carries no `sub` claim (extractTenantContext only accepts JWT_SECRET tokens
// that have one) and is signed with a key derived for this purpose only.

const SCOPE = 'sandbox_llm';

function signingKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(`${secret}:sandbox-llm-v1`);
}

export interface SandboxLLMClaims {
  tenantId: string;
  missionId: string;
  agentRole: string;
  tokenId: string;
}

export async function mintSandboxLLMToken(
  claims: Omit<SandboxLLMClaims, 'tokenId'>,
  ttlSeconds = 1800,
): Promise<string> {
  return new SignJWT({ tid: claims.tenantId, mid: claims.missionId, role: claims.agentRole, scope: SCOPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(signingKey());
}

export async function verifySandboxLLMToken(token: string): Promise<SandboxLLMClaims | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    if (payload.scope !== SCOPE || payload.sub !== undefined) return null;
    if (typeof payload.tid !== 'string' || typeof payload.jti !== 'string') return null;
    return {
      tenantId: payload.tid,
      missionId: typeof payload.mid === 'string' ? payload.mid : '',
      agentRole: typeof payload.role === 'string' ? payload.role : 'agent',
      tokenId: payload.jti,
    };
  } catch {
    return null;
  }
}
