import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/services/notifications';

export const maxDuration = 15;

// GET /api/team — list team members for the current tenant (owner view)
export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('team_members')
    .select('id, member_email, member_user_id, role, status, invited_at, accepted_at')
    .eq('owner_tenant_id', tenantId)
    .neq('status', 'revoked')
    .order('invited_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ members: data ?? [] });
}

// POST /api/team — invite a new team member
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { email, role = 'viewer' } = await request.json() as { email: string; role?: string };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  if (!['admin', 'editor', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'Role must be admin, editor, or viewer' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Get the owner's name/email for the invite message
  const { data: { user: owner } } = await supabase.auth.admin.getUserById(tenantId);
  const ownerName = owner?.user_metadata?.full_name || owner?.email || 'Your team';

  // Upsert invite — if already invited, reset the token and resend
  const { data: invite, error } = await supabase
    .from('team_members')
    .upsert(
      { owner_tenant_id: tenantId, member_email: email.toLowerCase(), role, status: 'pending',
        invite_token: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex'),
        invited_at: new Date().toISOString(), accepted_at: null },
      { onConflict: 'owner_tenant_id,member_email' }
    )
    .select('id, invite_token, role')
    .single();

  if (error || !invite) {
    return NextResponse.json({ error: error?.message || 'Failed to create invite' }, { status: 500 });
  }

  const acceptUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://agenticfactor.io'}/team/accept?token=${invite.invite_token}`;

  // Send invite email
  await sendEmail({
    to: email,
    subject: `${ownerName} invited you to join their AgenticFactor team`,
    body: `You've been invited to join ${ownerName}'s team on AgenticFactor as a ${role}.\n\nAccept your invite: ${acceptUrl}`,
    htmlBody: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;">
        <h2 style="margin:0 0 16px">You're invited to AgenticFactor 🤖</h2>
        <p><strong>${ownerName}</strong> has invited you to join their team as a <strong>${role}</strong>.</p>
        <a href="${acceptUrl}" style="display:inline-block;margin:24px 0;padding:12px 28px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
          Accept Invite
        </a>
        <p style="color:#888;font-size:0.85rem">Or paste this link: ${acceptUrl}</p>
        <p style="color:#888;font-size:0.8rem">This invite was sent from AgenticFactor. If you weren't expecting this, you can ignore it.</p>
      </div>`,
  });

  return NextResponse.json({ success: true, memberId: invite.id });
}

// PATCH /api/team — update a member's role
export async function PATCH(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { memberId, role } = await request.json() as { memberId: string; role: string };
  if (!memberId || !['admin', 'editor', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'memberId and valid role required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('team_members')
    .update({ role })
    .eq('id', memberId)
    .eq('owner_tenant_id', tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/team?memberId=xxx — revoke a team member
export async function DELETE(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const memberId = new URL(request.url).searchParams.get('memberId');
  if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('team_members')
    .update({ status: 'revoked' })
    .eq('id', memberId)
    .eq('owner_tenant_id', tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
