import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { jwtVerify } from 'jose';

export interface TenantContext {
  tenantId: string;
  userId: string;
}

export async function extractTenantContext(
  request: NextRequest
): Promise<TenantContext | NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ── Method 1: Supabase cookie session (primary) ──
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll() {},
        },
      });
      const { data: { user }, error } = await supabase.auth.getUser();
      if (user && !error) {
        return { tenantId: user.id, userId: user.id };
      }
    } catch {
      // Fall through to Bearer token check
    }
  }

  // ── Method 2: Signed JWT Bearer token (for API key / programmatic access) ──
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
      try {
        const secret = new TextEncoder().encode(jwtSecret);
        const { payload } = await jwtVerify(token, secret);
        const tenantId = payload.sub as string;
        if (tenantId) {
          return { tenantId, userId: tenantId };
        }
      } catch {
        // Invalid or expired token — fall through to 401
      }
    }
  }

  return NextResponse.json(
    { error: 'Authentication required.', code: 'AUTH_REQUIRED' },
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
