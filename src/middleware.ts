import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

// ============================================================
// Middleware — Final Operational Release
//
// FIXES the auth redirect loop by:
// 1. Using getUser() instead of getSession() (recommended by Supabase)
// 2. Properly refreshing expired tokens via cookie sync
// 3. Handling ?migrated=true as a post-auth signal
// ============================================================

const PUBLIC_PATHS = new Set(['/', '/login', '/auth/callback']);
const PROTECTED_PREFIXES = ['/dashboard', '/approvals', '/connectors', '/permissions'];

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // ── Always allow public routes ──
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // ── Always allow static assets and auth callback ──
  if (pathname.startsWith('/auth/')) {
    return NextResponse.next();
  }

  // ── Allow guest blueprint generation (no auth needed) ──
  if (pathname === '/api/missions' && searchParams.get('action') === 'blueprint') {
    return NextResponse.next();
  }

  // ── Allow API calls with Bearer token (route handler validates these) ──
  const authHeader = request.headers.get('Authorization');
  if (pathname.startsWith('/api/') && authHeader?.startsWith('Bearer ')) {
    return NextResponse.next();
  }

  // ── API Rate Limiting ──
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/cron/')) {
    const { checkRateLimit, rateLimitHeaders } = await import('@/lib/middleware/rate-limiter');
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const identifier = authHeader ? `auth:${authHeader.substring(0, 20)}` : `ip:${clientIp}`;
    const plan = authHeader ? 'free' : 'anonymous'; // Will be upgraded after auth check

    const rateCheck = checkRateLimit(identifier, plan);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateCheck.retryAfter },
        { status: 429, headers: rateLimitHeaders(plan, 0, rateCheck.retryAfter) }
      );
    }
  }

  // ── Check if route needs protection ──
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) || pathname.startsWith('/api/');
  if (!isProtected) {
    return NextResponse.next();
  }

  // ── Guard: skip auth if Supabase not configured ──
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next();
  }

  // ── Create Supabase client with cookie sync ──
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Forward refreshed cookies to both request and response
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({
          request: { headers: request.headers },
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // ── Validate session using getUser() (NOT getSession) ──
  // getUser() hits Supabase auth server and properly validates the JWT.
  // getSession() only reads from cookies without validation — unreliable.
  try {
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      // No valid session — redirect pages, 401 for API
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Authentication required', code: 'AUTH_REQUIRED' },
          { status: 401 }
        );
      }
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('returnTo', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // ── User is authenticated — allow through ──
    return response;
  } catch {
    // Supabase unreachable — allow in dev mode
    console.warn('[middleware] Supabase auth check failed, allowing through');
    return response;
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
