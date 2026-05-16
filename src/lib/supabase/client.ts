import { createClient } from '@supabase/supabase-js';

/**
 * Browser-side Supabase client (uses anon key).
 * RLS policies enforce tenant isolation automatically.
 */
export function createBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(supabaseUrl, supabaseAnonKey);
}
