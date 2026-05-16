import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export interface TenantContext {
  tenantId: string;
  userId: string;
}

/**
 * Extracts tenant context from the Supabase session cookie.
 * 
 * Supports TWO auth methods:
 * 1. Supabase cookie session (primary — from OAuth flow)
 * 2. Bearer token with demo-token fallback (for guest/demo mode)
 *
 * In production, tenant_id = user.id (each user is their own tenant).
 * RLS is the primary wall — this provides the app-level guard.
 */
export async function extractTenantContext(
  request: NextRequest
): Promise<TenantContext | NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ── Method 1: Supabase cookie session ──
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll() {
            // Read-only — we don't need to set cookies in API routes
          },
        },
      });

      const { data: { user }, error } = await supabase.auth.getUser();
      if (user && !error) {
        return {
          tenantId: user.id,
          userId: user.id,
        };
      }
    } catch {
      // Fall through to Bearer token check
    }
  }

  // ── Method 2: Bearer token (demo/legacy) ──
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    // Demo mode — accept demo-token for testing
    if (token === 'demo-token') {
      return {
        tenantId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000001',
      };
    }

    // Custom JWT verification could go here for API-key auth
  }

  return NextResponse.json(
    { error: 'Authentication required. Sign in or provide a Bearer token.', code: 'AUTH_REQUIRED' },
    { status: 401 }
  );
}

/**
 * Helper to check if extractTenantContext returned an error response.
 */
export function isAuthError(
  result: TenantContext | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
