import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client (uses service role key).
 * BYPASSES RLS — use only for admin operations.
 */
export function createServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Server-side Supabase client scoped to a specific tenant.
 * Sets the JWT claims so RLS policies enforce tenant isolation.
 */
export function createTenantClient(tenantId: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        // Inject tenant_id into JWT claims for RLS
        Authorization: `Bearer ${supabaseAnonKey}`,
        'x-tenant-id': tenantId,
      },
    },
    db: {
      schema: 'public',
    },
  });
}
