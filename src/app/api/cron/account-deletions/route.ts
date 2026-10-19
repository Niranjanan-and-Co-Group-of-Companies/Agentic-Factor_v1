import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { deleteAccount, dueDeletions, revokeComposioConnections, type DeletionReport } from '@/lib/services/account-deletion';

export const maxDuration = 300;

/**
 * Daily: deletes the accounts whose 7-day window has passed. ?dryRun=1 only reports what it would
 * delete; ?tenantId= limits it to one account (with dryRun, any account — for checking the job).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const only = request.nextUrl.searchParams.get('tenantId');
  const supabase = createServiceClient();
  const due = await dueDeletions(supabase);
  const tenants = only ? (dryRun || due.includes(only) ? [only] : []) : due;

  const { cancelSubscription, getSubscription } = await import('@/lib/services/razorpay');
  const deps = {
    cancelSubscription: async (id: string) => {
      try {
        await cancelSubscription(id);
      } catch (err) {
        // Already ended: nothing left to cancel.
        const sub = await getSubscription(id).catch(() => null) as { status?: string } | null;
        if (!sub || !['cancelled', 'completed', 'expired'].includes(sub.status ?? '')) throw err;
      }
    },
    revokeAppConnections: revokeComposioConnections,
  };

  const reports: DeletionReport[] = [];
  const failures: Array<{ tenantId: string; error: string }> = [];
  for (const tenantId of tenants) {
    // The address to tell them it's done, read before the login is gone.
    const { data: user } = await supabase.auth.admin.getUserById(tenantId);
    try {
      reports.push(await deleteAccount(supabase, tenantId, deps, dryRun));
      if (!dryRun && user?.user?.email) {
        const { sendEmail } = await import('@/lib/services/email-notifications');
        await sendEmail({
          to: user.user.email,
          subject: 'Your Agentic Factor account has been deleted',
          htmlBody: '<p>As you asked, your account and all its data have been permanently deleted. Thank you for trying Agentic Factor.</p>',
        }).catch(() => {});
      }
    } catch (err) {
      failures.push({ tenantId, error: (err as Error).message });
    }
  }

  if (failures.length > 0) {
    const { sendEmail, ADMIN_EMAIL } = await import('@/lib/services/email-notifications');
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `⚠️ ${failures.length} account deletion(s) could not finish`,
      htmlBody: `<p>They will be retried tomorrow. Nothing was deleted where cancelling the subscription or revoking app connections failed.</p><pre>${JSON.stringify(failures, null, 2).replace(/</g, '&lt;')}</pre>`,
    }).catch(() => {});
  }
  return NextResponse.json({ dryRun, deleted: dryRun ? 0 : reports.length, reports, failures });
}
