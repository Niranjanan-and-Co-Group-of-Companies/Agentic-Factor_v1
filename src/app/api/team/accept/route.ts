import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 10;

// GET /api/team/accept?token=xxx — public: fetch invite details without revealing sensitive data
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: invite, error } = await supabase
    .from('team_members')
    .select('id, owner_tenant_id, member_email, role, status')
    .eq('invite_token', token)
    .single();

  if (error || !invite) {
    return NextResponse.json({ error: 'Invite not found or expired' }, { status: 404 });
  }

  if (invite.status !== 'pending') {
    return NextResponse.json({ error: `Invite is ${invite.status}` }, { status: 409 });
  }

  // Fetch owner display name (safe — only name/email)
  const { data: { user: owner } } = await supabase.auth.admin.getUserById(invite.owner_tenant_id);
  const ownerName = owner?.user_metadata?.full_name || owner?.email || 'A team owner';

  return NextResponse.json({
    inviteId: invite.id,
    ownerName,
    memberEmail: invite.member_email,
    role: invite.role,
  });
}

// POST /api/team/accept — authenticated: accept an invite
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId: userId } = authResult;

  const { token } = await request.json() as { token: string };
  if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 });

  const supabase = createServiceClient();

  const { data: invite, error } = await supabase
    .from('team_members')
    .select('id, owner_tenant_id, member_email, role, status')
    .eq('invite_token', token)
    .single();

  if (error || !invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  if (invite.status !== 'pending') return NextResponse.json({ error: `Invite already ${invite.status}` }, { status: 409 });

  // Prevent owner from accepting their own invite
  if (invite.owner_tenant_id === userId) {
    return NextResponse.json({ error: 'You cannot join your own team' }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from('team_members')
    .update({
      member_user_id: userId,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    })
    .eq('id', invite.id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ success: true, role: invite.role, ownerTenantId: invite.owner_tenant_id });
}
