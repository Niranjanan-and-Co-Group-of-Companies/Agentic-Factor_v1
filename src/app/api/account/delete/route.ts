import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 30;

/**
 * POST /api/account/delete { confirm: "DELETE" } — the customer asks for their account to be deleted
 * (the app stores require this inside the app). Their missions stop running at once; the account and
 * its data are then removed by the team within 30 days, as the confirmation says, after any active
 * subscription has been cancelled.
 */
export async function POST(request: NextRequest) {
  const auth = await extractTenantContext(request);
  if (isAuthError(auth)) return auth;
  const { tenantId, userId } = auth;

  const { confirm } = await request.json().catch(() => ({})) as { confirm?: unknown };
  if (confirm !== 'DELETE') return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: user } = await supabase.auth.admin.getUserById(userId);
  const email = user?.user?.email ?? 'unknown';

  // Nothing runs on the account from now on.
  await supabase.from('missions').update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).in('status', ['active', 'running']);
  await supabase.from('events').insert({
    tenant_id: tenantId, event_type: 'account.deletion_requested', entity_type: 'account', entity_id: tenantId,
    payload: { email, requestedAt: new Date().toISOString() },
  });

  try {
    const { sendEmail, ADMIN_EMAIL } = await import('@/lib/services/email-notifications');
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `Account deletion requested: ${email}`,
      htmlBody: `<p>${email} (tenant ${tenantId}) asked for their account to be deleted from the app. Their missions were paused. Cancel any subscription, then delete the account and its data within 30 days.</p>`,
    });
    if (email !== 'unknown') {
      await sendEmail({
        to: email,
        subject: 'We received your request to delete your Agentic Factor account',
        htmlBody: '<p>Your missions have been stopped. Your account and its data will be deleted within 30 days. If this wasn’t you, reply to this email straight away.</p>',
      });
    }
  } catch (err) {
    console.warn('[account/delete] Notification failed:', err);
  }

  return NextResponse.json({ ok: true, message: 'Your missions have been stopped, and your account and its data will be deleted within 30 days. We emailed you a confirmation.' });
}
