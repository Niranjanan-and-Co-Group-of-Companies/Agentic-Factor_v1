import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// ============================================================
// POST /api/admin/auth — Admin Login (email + password → OTP)
// GET  /api/admin/auth — Check admin session
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, email, password, otp } = body;

    const { ensurePrimaryAdmin, verifyCredentialsAndSendOTP, verifyOTP } = await import('@/lib/services/admin-auth');

    // Step 1: Verify email + password → send OTP
    if (action === 'login') {
      await ensurePrimaryAdmin();

      if (!email || !password) {
        return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
      }

      const result = await verifyCredentialsAndSendOTP(email, password);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 401 });
      }

      return NextResponse.json({ success: true, step: 'otp_sent', message: 'OTP sent to your email' });
    }

    // Step 2: Verify OTP → create session
    if (action === 'verify_otp') {
      if (!email || !otp) {
        return NextResponse.json({ error: 'Email and OTP required' }, { status: 400 });
      }

      const result = await verifyOTP(email, otp);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 401 });
      }

      // Set admin session cookie
      const cookieStore = await cookies();
      cookieStore.set('admin_session', result.token!, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 8, // 8 hours
        path: '/',
      });
      cookieStore.set('admin_email', email, {
        httpOnly: false, // Readable by client for UI
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 8,
        path: '/',
      });

      return NextResponse.json({ success: true, step: 'authenticated' });
    }

    // Logout
    if (action === 'logout') {
      const cookieStore = await cookies();
      cookieStore.delete('admin_session');
      cookieStore.delete('admin_email');
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('[Admin Auth]', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// Check if admin is authenticated
export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get('admin_session');
  const email = cookieStore.get('admin_email');

  if (!session?.value || !email?.value) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, email: email.value });
}
