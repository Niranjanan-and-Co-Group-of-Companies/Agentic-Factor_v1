import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 10;

// GET /api/team/accept?token=xxx — public: fetch invite details
// Works for both workspace (team_members) and mission (mission_members) invites.
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 });

  const supabase = createServiceClient();

  // Check workspace invites first
  const { data: wsInvite } = await supabase
    .from('team_members')
    .select('id, owner_tenant_id, member_email, role, status')
    .eq('invite_token', token)
    .maybeSingle();

  if (wsInvite) {
    if (wsInvite.status !== 'pending') {
      return NextResponse.json({ error: `Invite is ${wsInvite.status}` }, { status: 409 });
    }
    const { data: { user: owner } } = await supabase.auth.admin.getUserById(wsInvite.owner_tenant_id);
    const ownerName = owner?.user_metadata?.full_name || owner?.email || 'A team owner';
    return NextResponse.json({
      inviteId: wsInvite.id, ownerName, memberEmail: wsInvite.member_email,
      role: wsInvite.role, type: 'workspace',
    });
  }

  // Check mission invites
  const { data: missionInvite } = await supabase
    .from('mission_members')
    .select('id, owner_tenant_id, member_email, role, status, mission_id')
    .eq('invite_token', token)
    .maybeSingle();

  if (missionInvite) {
    if (missionInvite.status !== 'pending') {
      return NextResponse.json({ error: `Invite is ${missionInvite.status}` }, { status: 409 });
    }
    const [ownerResult, missionResult] = await Promise.all([
      supabase.auth.admin.getUserById(missionInvite.owner_tenant_id),
      supabase.from('missions').select('title').eq('id', missionInvite.mission_id).single(),
    ]);
    const ownerName = ownerResult.data.user?.user_metadata?.full_name || ownerResult.data.user?.email || 'A team owner';
    return NextResponse.json({
      inviteId: missionInvite.id, ownerName, memberEmail: missionInvite.member_email,
      role: missionInvite.role, type: 'mission', missionTitle: missionResult.data?.title ?? 'a mission',
    });
  }

  return NextResponse.json({ error: 'Invite not found or expired' }, { status: 404 });
}

// POST /api/team/accept — authenticated: accept an invite (workspace or mission)
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId: userId } = authResult;

  const { token } = await request.json() as { token: string };
  if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 });

  const supabase = createServiceClient();

  // Try workspace invite first
  const { data: wsInvite } = await supabase
    .from('team_members')
    .select('id, owner_tenant_id, role, status')
    .eq('invite_token', token)
    .maybeSingle();

  if (wsInvite) {
    if (wsInvite.status !== 'pending') {
      return NextResponse.json({ error: `Invite already ${wsInvite.status}` }, { status: 409 });
    }
    if (wsInvite.owner_tenant_id === userId) {
      return NextResponse.json({ error: 'You cannot join your own team' }, { status: 400 });
    }
    const { error } = await supabase.from('team_members').update({
      member_user_id: userId, status: 'accepted', accepted_at: new Date().toISOString(),
    }).eq('id', wsInvite.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, role: wsInvite.role, type: 'workspace', ownerTenantId: wsInvite.owner_tenant_id });
  }

  // Try mission invite
  const { data: missionInvite } = await supabase
    .from('mission_members')
    .select('id, owner_tenant_id, role, status, mission_id')
    .eq('invite_token', token)
    .maybeSingle();

  if (missionInvite) {
    if (missionInvite.status !== 'pending') {
      return NextResponse.json({ error: `Invite already ${missionInvite.status}` }, { status: 409 });
    }
    if (missionInvite.owner_tenant_id === userId) {
      return NextResponse.json({ error: 'You cannot join your own mission' }, { status: 400 });
    }
    const { error } = await supabase.from('mission_members').update({
      member_user_id: userId, status: 'accepted', accepted_at: new Date().toISOString(),
    }).eq('id', missionInvite.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, role: missionInvite.role, type: 'mission', missionId: missionInvite.mission_id });
  }

  return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
}
