import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';

// ============================================================
// POST /api/email/configure — Set up mission email inbox
// GET  /api/email/configure?missionId=xxx — Get email config
//
// Creates unique inbound email address per mission and manages
// the sender whitelist. Limits based on plan:
//   Free: not available
//   Individual: 1 sender per mission
//   Pro: seat_count + 1 senders per mission
//   Enterprise: contact sales (managed)
// ============================================================

const ConfigureSchema = z.object({
  missionId: z.string().uuid(),
  allowedSenders: z.array(z.string().email()).optional(),
});

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const body = await request.json();
    const { missionId, allowedSenders } = ConfigureSchema.parse(body);

    const supabase = createServiceClient();

    // Verify mission ownership
    const { data: mission } = await supabase
      .from('missions')
      .select('id, title, inbound_email, allowed_senders')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();

    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    // Get tenant's plan for sender limits
    const { data: billing } = await supabase
      .from('tenant_billing')
      .select('plan, seat_count')
      .eq('tenant_id', tenantId)
      .single();

    const plan = billing?.plan || 'free';
    const seatCount = billing?.seat_count || 1;

    // Check plan eligibility
    if (plan === 'free') {
      return NextResponse.json(
        { error: 'Email inbox not available on Free plan. Upgrade to Individual or higher.' },
        { status: 403 }
      );
    }

    // Sender limits per plan
    const maxSenders: Record<string, number> = {
      individual: 1,
      pro: seatCount + 1,
      enterprise: 100, // Effectively unlimited
    };
    const limit = maxSenders[plan] || 1;

    if (allowedSenders && allowedSenders.length > limit) {
      return NextResponse.json(
        { error: `Your ${plan} plan allows max ${limit} sender(s) per mission. You provided ${allowedSenders.length}.` },
        { status: 400 }
      );
    }

    // Generate inbound email if not yet assigned
    let inboundEmail = mission.inbound_email;
    if (!inboundEmail) {
      const slug = mission.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 20);
      const shortId = Math.random().toString(36).slice(2, 8);
      inboundEmail = `${slug}-${shortId}@agents.agenticfactor.io`;
    }

    // Update mission
    const { error } = await supabase
      .from('missions')
      .update({
        inbound_email: inboundEmail,
        allowed_senders: allowedSenders || mission.allowed_senders || [],
      })
      .eq('id', missionId);

    if (error) {
      throw new Error(`Failed to configure email: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      inboundEmail,
      allowedSenders: allowedSenders || mission.allowed_senders || [],
      maxSenders: limit,
      plan,
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 });
    }
    console.error('[POST /api/email/configure] Error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const missionId = request.nextUrl.searchParams.get('missionId');
  if (!missionId) {
    return NextResponse.json({ error: 'missionId required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: mission } = await supabase
    .from('missions')
    .select('id, inbound_email, allowed_senders')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  if (!mission) {
    return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
  }

  // Get sender limits
  const { data: billing } = await supabase
    .from('tenant_billing')
    .select('plan, seat_count')
    .eq('tenant_id', tenantId)
    .single();

  const plan = billing?.plan || 'free';
  const seatCount = billing?.seat_count || 1;
  const maxSenders: Record<string, number> = {
    free: 0,
    individual: 1,
    pro: seatCount + 1,
    enterprise: 100,
  };

  return NextResponse.json({
    inboundEmail: mission.inbound_email,
    allowedSenders: mission.allowed_senders || [],
    maxSenders: maxSenders[plan] || 0,
    plan,
    available: plan !== 'free',
  });
}
