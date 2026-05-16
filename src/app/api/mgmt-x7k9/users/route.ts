import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// ============================================================
// Admin Users CRUD — Add, Remove, List admin users
// Protected: requires valid admin_session cookie.
// ============================================================

async function requireAdmin(): Promise<{ ok: boolean; email?: string }> {
  const cookieStore = await cookies();
  const session = cookieStore.get('admin_session');
  const email = cookieStore.get('admin_email');
  if (!session?.value || !email?.value) return { ok: false };
  return { ok: true, email: email.value };
}

// GET — List all admin users
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { listAdmins } = await import('@/lib/services/admin-auth');
  const admins = await listAdmins();
  return NextResponse.json({ admins });
}

// POST — Add a new admin user
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { email, password } = await request.json();
  if (!email || !password || password.length < 8) {
    return NextResponse.json({ error: 'Email and password (min 8 chars) required' }, { status: 400 });
  }

  const { addAdmin } = await import('@/lib/services/admin-auth');
  const result = await addAdmin(email, password);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({ success: true, message: `Admin ${email} added. Login credentials sent via email.` });
}

// DELETE — Remove an admin user
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { adminId } = await request.json();
  if (!adminId) {
    return NextResponse.json({ error: 'adminId required' }, { status: 400 });
  }

  const { removeAdmin } = await import('@/lib/services/admin-auth');
  const result = await removeAdmin(adminId);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  return NextResponse.json({ success: true });
}
