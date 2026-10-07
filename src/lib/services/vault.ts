import { createServiceClient } from '../supabase/server';

// ============================================================
// Vault Service — Tenant Secret Encryption
// Encrypts API keys with AES-256-GCM using per-tenant derived keys.
// Stores encrypted values in the permissions table.
// ============================================================

async function deriveAesKey(tenantId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const masterSecret = process.env.JWT_SECRET;
  if (!masterSecret) throw new Error('JWT_SECRET env var is not set — cannot encrypt vault keys');
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(masterSecret), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode(`tenant:${tenantId}`), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plaintext token for storage in tenant_permissions.encrypted_token.
 * Returns base64-encoded "IV(12 bytes) + ciphertext".
 */
export async function encryptToken(tenantId: string, plaintext: string): Promise<string> {
  const aesKey = await deriveAesKey(tenantId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoder.encode(plaintext));
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), 12);
  return Buffer.from(combined).toString('base64');
}

/**
 * Decrypt a base64 "IV+ciphertext" produced by encryptToken.
 */
export async function decryptToken(tenantId: string, stored: string): Promise<string> {
  const aesKey = await deriveAesKey(tenantId);
  const combined = Buffer.from(stored, 'base64');
  const iv = combined.subarray(0, 12);
  const ciphertext = combined.subarray(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
  return new TextDecoder().decode(plaintext);
}

/**
 * Plaintext credential for a tenant_permissions row: decrypts encrypted_token when present,
 * otherwise returns access_token unchanged (including the 'composio_managed' marker).
 */
export async function plaintextToken(
  tenantId: string,
  row: { access_token?: string | null; encrypted_token?: string | null } | null | undefined
): Promise<string | null> {
  if (!row) return null;
  if (row.encrypted_token) {
    try { return await decryptToken(tenantId, row.encrypted_token); } catch { /* fall through */ }
  }
  const raw = row.access_token;
  return raw && raw !== '[encrypted]' ? raw : null;
}

/**
 * Read the decrypted token for a given tenant+provider from tenant_permissions.
 * Prefers encrypted_token; falls back to access_token for pre-encryption rows.
 * Returns null if no record found or token is the Composio marker.
 */
export async function readDecryptedToken(
  tenantId: string,
  provider: string
): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token, encrypted_token')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .maybeSingle();
  if (!data) return null;
  if (data.encrypted_token) {
    try { return await decryptToken(tenantId, data.encrypted_token); } catch { /* fall through */ }
  }
  const raw = data.access_token;
  if (!raw || raw === 'composio_managed') return null;
  return raw;
}

/**
 * Encrypt a secret value using Web Crypto API (AES-256-GCM).
 * In production, derive per-tenant keys from a master key via HKDF.
 */
export async function encryptSecret(
  plaintext: string,
  tenantId: string
): Promise<{ encrypted: Uint8Array; iv: Uint8Array }> {
  const encoder = new TextEncoder();

  // Derive a per-tenant key (PBKDF2 from tenant_id + master secret)
  const masterSecret = process.env.JWT_SECRET;
  if (!masterSecret) throw new Error('JWT_SECRET env var is not set — cannot encrypt vault keys');
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(masterSecret), 'PBKDF2', false, ['deriveKey']
  );

  const salt = encoder.encode(`tenant:${tenantId}`);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  // Encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encoder.encode(plaintext)
  );

  return { encrypted: new Uint8Array(ciphertext), iv };
}

/**
 * Store an encrypted credential in the permissions table.
 */
export async function storeCredential(
  permissionId: string,
  tenantId: string,
  plaintext: string,
  grantedBy: string
): Promise<void> {
  const { encrypted, iv } = await encryptSecret(plaintext, tenantId);

  // Combine IV + ciphertext for storage
  const combined = new Uint8Array(iv.length + encrypted.length);
  combined.set(iv);
  combined.set(encrypted, iv.length);

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('permissions')
    .update({
      encrypted_value: Array.from(combined),
      granted: true,
      granted_at: new Date().toISOString(),
      granted_by: grantedBy,
    })
    .eq('id', permissionId)
    .eq('tenant_id', tenantId);

  if (error) throw new Error(`Failed to store credential: ${error.message}`);

  // Audit event
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'permission.credential_stored',
    entity_type: 'permission',
    entity_id: permissionId,
    actor: grantedBy,
    payload: { grantedAt: new Date().toISOString() },
  });
}
