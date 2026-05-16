import { createServiceClient } from '../supabase/server';

// ============================================================
// Vault Service — Tenant Secret Encryption
// Encrypts API keys with AES-256-GCM using per-tenant derived keys.
// Stores encrypted values in the permissions table.
// ============================================================

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
  const masterSecret = process.env.JWT_SECRET || 'fallback-secret-min-32-chars-long!!';
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
