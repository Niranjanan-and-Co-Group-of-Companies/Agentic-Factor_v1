import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { cancelDeletion, deletionStatus, GRACE_DAYS, requestDeletion } from '@/lib/services/account-deletion';

export const maxDuration = 30;

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** GET — whether this account is due to be deleted, and when. */
export async function GET(request: NextRequest) {
  const auth = await extractTenantContext(request);
  if (isAuthError(auth)) return auth;
  return NextResponse.json(await deletionStatus(createServiceClient(), auth.tenantId));
}

/**
 * POST { confirm: "DELETE" } — the customer asks for their account to be deleted (the app stores
 * require this inside the app). Everything stops now; it is deleted for good after 7 days unless they
 * cancel (DELETE below) — the daily account-deletions job does it.
 */
export async function POST(request: NextRequest) {
  const auth = await extractTenantContext(request);
  if (isAuthError(auth)) return auth;
  const { tenantId, userId } = auth;

  const { confirm } = await request.json().catch(() => ({})) as { confirm?: unknown };
  if (confirm !== 'DELETE') return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: user } = await supabase.auth.admin.getUserById(userId);
  const email = user?.user?.email ?? '';
  const status = await requestDeletion(supabase, tenantId, email);
  const when = day(status.deleteAfter!);

  try {
    const { sendEmail, ADMIN_EMAIL } = await import('@/lib/services/email-notifications');
    if (email) {
      await sendEmail({
        to: email,
        subject: 'Your Agentic Factor account will be deleted',
        htmlBody: `<p>Your missions have been stopped. Your account, its missions, chats, files and app connections will be permanently deleted on <b>${when}</b>.</p><p>Changed your mind? Open the Agentic Factor app → Account → <b>Keep my account</b> before then.</p><p>If this wasn’t you, reply to this email straight away.</p>`,
      });
    }
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `Account deletion requested: ${email || tenantId}`,
      htmlBody: `<p>${email || 'An account'} (tenant ${tenantId}) asked for deletion. Missions were paused; it will be deleted automatically on ${when} unless they cancel.</p>`,
    });
  } catch (err) {
    console.warn('[account/delete] Notification failed:', err);
  }

  return NextResponse.json({
    ...status,
    message: `Your missions have been stopped. Your account and all its data will be deleted on ${when}. You can keep it until then from Account → Keep my account.`,
    graceDays: GRACE_DAYS,
  });
}

/** DELETE — keep the account: the pending deletion is cancelled and missions run and are scheduled as before. */
export async function DELETE(request: NextRequest) {
  const auth = await extractTenantContext(request);
  if (isAuthError(auth)) return auth;
  const cancelled = await cancelDeletion(createServiceClient(), auth.tenantId);
  return NextResponse.json({ cancelled, message: cancelled ? 'Your account will not be deleted. Your missions run and are scheduled as before.' : 'No deletion was pending.' });
}
