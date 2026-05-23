import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// ============================================================
// OAuth Callback — /auth/callback
//
// Flow: OAuth provider → Supabase → this route → redirect
// Handles: code exchange, session cookie, guest blueprint migration
// ============================================================
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const returnTo = requestUrl.searchParams.get('returnTo') || '/';

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', request.url));
  }

  // Only set migrated=true when returning to home page (blueprint migration)
  // Do NOT set it for /connectors, /dashboard, etc.
  const redirectUrl = new URL(returnTo, request.url);
  if (returnTo === '/' || returnTo === '') {
    redirectUrl.searchParams.set('migrated', 'true');
  }

  const response = NextResponse.redirect(redirectUrl);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth/callback] Exchange failed:', error.message);
      return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
    }

    // Auto-provision billing record for new users (free trial)
    if (data?.user?.id) {
      try {
        const { ensureBillingRecord } = await import('@/lib/middleware/billing');
        await ensureBillingRecord(data.user.id);
      } catch (billingErr) {
        console.warn('[auth/callback] Billing provisioning failed (non-fatal):', billingErr);
      }
    }
  } catch (err) {
    console.error('[auth/callback] Exception:', err);
    return NextResponse.redirect(new URL('/login?error=exception', request.url));
  }

  return response;
}
