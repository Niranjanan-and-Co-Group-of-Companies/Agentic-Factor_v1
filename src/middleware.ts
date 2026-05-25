import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

// ============================================================
// Middleware — v2: Fixed Rate Limiting
//
// KEY CHANGES:
// 1. Rate limiting now runs AFTER auth so cookie-auth users
//    get their real plan limits, not 'anonymous' (5 req/min).
// 2. Critical endpoints (execute, inngest) skip rate limiting.
// 3. Increased base limits to support polling-based UI.
// ============================================================

const PUBLIC_PATHS = new Set(['/', '/login', '/auth/callback']);
const PROTECTED_PREFIXES = ['/dashboard', '/approvals', '/connectors', '/permissions'];

// Paths that skip rate limiting entirely (critical execution paths)
const RATE_LIMIT_EXEMPT_PATTERNS = [
  '/api/inngest',
  '/api/cron/',
];

// Check if path matches any exempt pattern
function isRateLimitExempt(pathname: string): boolean {
  return RATE_LIMIT_EXEMPT_PATTERNS.some(p =>
    pathname === p || pathname.startsWith(p)
  ) || /\/api\/missions\/[^/]+\/execute/.test(pathname);
}

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

  // ── Allow Inngest webhook (secured by signing key, not Supabase auth) ──
  if (pathname === '/api/inngest') {
    return NextResponse.next();
  }

  // ── Allow API calls with Bearer token (route handler validates these) ──
  const authHeader = request.headers.get('Authorization');
  if (pathname.startsWith('/api/') && authHeader?.startsWith('Bearer ')) {
    return NextResponse.next();
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
  try {
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      // ── Unauthenticated: Apply anonymous rate limit for API routes ──
      if (pathname.startsWith('/api/')) {
        if (!isRateLimitExempt(pathname)) {
          const { checkRateLimit, rateLimitHeaders } = await import('@/lib/middleware/rate-limiter');
          const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
          const rateCheck = checkRateLimit(`ip:${clientIp}`, 'anonymous');
          if (!rateCheck.allowed) {
            return NextResponse.json(
              { error: 'Rate limit exceeded', retryAfter: rateCheck.retryAfter },
              { status: 429, headers: rateLimitHeaders('anonymous', 0, rateCheck.retryAfter) }
            );
          }
        }
        return NextResponse.json(
          { error: 'Authentication required', code: 'AUTH_REQUIRED' },
          { status: 401 }
        );
      }
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('returnTo', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // ── User is authenticated ──
    // Apply rate limiting with the user's REAL plan (not anonymous)
    if (pathname.startsWith('/api/') && !isRateLimitExempt(pathname)) {
      const { checkRateLimit, rateLimitHeaders } = await import('@/lib/middleware/rate-limiter');
      
      // Determine user's plan from metadata (set during signup/upgrade)
      const userPlan = (user.user_metadata?.plan as string) || 'free';
      const identifier = `user:${user.id}`;

      const rateCheck = checkRateLimit(identifier, userPlan);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: 'Rate limit exceeded', retryAfter: rateCheck.retryAfter },
          { status: 429, headers: rateLimitHeaders(userPlan, 0, rateCheck.retryAfter) }
        );
      }
    }

    return response;
  } catch {
    console.warn('[middleware] Supabase auth check failed, allowing through');
    return response;
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
