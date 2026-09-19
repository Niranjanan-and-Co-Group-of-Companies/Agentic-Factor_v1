import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 15;

const SEAT_LIMITS: Record<string, number> = {
  free: 0, individual: 0, individual_annual: 0, pro: 25, pro_annual: 25, enterprise: 999999,
};

// GET /api/missions/[id]/invite — list mission members
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('mission_members')
    .select('id, member_email, member_user_id, role, status, invited_at, accepted_at')
    .eq('mission_id', missionId)
    .eq('owner_tenant_id', tenantId)
    .neq('status', 'revoked')
    .order('invited_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ members: data ?? [] });
}

// POST /api/missions/[id]/invite — invite someone to this mission only
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const { email, role = 'viewer' } = await request.json() as { email: string; role?: string };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }
  if (!['collaborator', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'Mission role must be collaborator or viewer' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // ── Plan + seat limit check ────────────────────────────────
  const { data: billing } = await supabase
    .from('tenant_billing')
    .select('plan')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const plan = (billing?.plan ?? 'free') as string;
  const seatLimit = SEAT_LIMITS[plan] ?? 0;

  if (seatLimit === 0) {
    return NextResponse.json(
      { error: `Team invites are not available on the ${plan} plan. Upgrade to Pro to invite members.` },
      { status: 403 }
    );
  }

  if (seatLimit < 999999) {
    const { data: countResult } = await supabase.rpc('get_seat_count', { p_owner_tenant_id: tenantId });
    const currentSeats = (countResult as number) ?? 0;
    if (currentSeats >= seatLimit) {
      return NextResponse.json(
        { error: `You've reached your ${seatLimit}-seat limit. Remove a member or upgrade to Enterprise.` },
        { status: 403 }
      );
    }
  }

  // ── If already a workspace member, no need for mission-level invite ──
  const { data: workspaceMember } = await supabase
    .from('team_members')
    .select('id, role')
    .eq('owner_tenant_id', tenantId)
    .eq('member_email', email.toLowerCase())
    .eq('status', 'accepted')
    .maybeSingle();

  if (workspaceMember) {
    return NextResponse.json(
      { error: `${email} already has full workspace access (${workspaceMember.role}). No mission-level invite needed.` },
      { status: 409 }
    );
  }

  // Fetch owner + mission info for the invite email
  const [ownerResult, missionResult] = await Promise.all([
    supabase.auth.admin.getUserById(tenantId),
    supabase.from('missions').select('title').eq('id', missionId).eq('tenant_id', tenantId).single(),
  ]);
  const ownerName = ownerResult.data.user?.user_metadata?.full_name || ownerResult.data.user?.email || 'Your team';
  const missionTitle = missionResult.data?.title ?? 'a mission';

  // Upsert invite
  const { data: invite, error } = await supabase
    .from('mission_members')
    .upsert(
      {
        mission_id: missionId,
        owner_tenant_id: tenantId,
        member_email: email.toLowerCase(),
        role,
        status: 'pending',
        invite_token: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex'),
        invited_at: new Date().toISOString(),
        accepted_at: null,
      },
      { onConflict: 'mission_id,member_email' }
    )
    .select('id, invite_token, role')
    .single();

  if (error || !invite) {
    return NextResponse.json({ error: error?.message || 'Failed to create invite' }, { status: 500 });
  }

  const acceptUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://agenticfactor.io'}/team/accept?token=${invite.invite_token}&type=mission`;

  // Send invite email
  const { sendEmail } = await import('@/lib/services/notifications');
  await sendEmail({
    to: email,
    subject: `${ownerName} invited you to view "${missionTitle}" on AgenticFactor`,
    body: `You've been invited to access "${missionTitle}" as a ${role}.\n\nAccept your invite: ${acceptUrl}`,
    htmlBody: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;">
        <h2 style="margin:0 0 16px">Mission access invitation 🤖</h2>
        <p><strong>${ownerName}</strong> has invited you to access the mission <strong>"${missionTitle}"</strong> on AgenticFactor as a <strong>${role}</strong>.</p>
        <p style="color:#64748b;font-size:0.9rem">You'll be able to ${role === 'collaborator' ? 'chat with the AI, run the mission, and view all history' : 'view the mission chat and run history'}.</p>
        <a href="${acceptUrl}" style="display:inline-block;margin:24px 0;padding:12px 28px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
          Accept Invite →
        </a>
        <p style="color:#888;font-size:0.8rem">Or paste: ${acceptUrl}</p>
        <p style="color:#888;font-size:0.8rem">This invite was sent from AgenticFactor. If you weren't expecting this, you can ignore it.</p>
      </div>`,
  });

  return NextResponse.json({ success: true, memberId: invite.id });
}

// PATCH /api/missions/[id]/invite — change role
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const { memberId, role } = await request.json() as { memberId: string; role: string };
  if (!memberId || !['collaborator', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'memberId and valid role required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('mission_members')
    .update({ role })
    .eq('id', memberId)
    .eq('mission_id', missionId)
    .eq('owner_tenant_id', tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/missions/[id]/invite?memberId=xxx — revoke mission access
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  const memberId = new URL(request.url).searchParams.get('memberId');
  if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('mission_members')
    .update({ status: 'revoked' })
    .eq('id', memberId)
    .eq('mission_id', missionId)
    .eq('owner_tenant_id', tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
