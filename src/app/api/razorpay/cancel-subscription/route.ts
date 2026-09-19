import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { cancelSubscription } from '@/lib/services/razorpay';

export const maxDuration = 15;

// POST /api/razorpay/cancel-subscription
// Cancels the tenant's active Razorpay subscription at end of current billing period.
// The tenant retains access and credits until billing_period_end.
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const supabase = createServiceClient();

  const { data: billing } = await supabase
    .from('tenant_billing')
    .select('plan, billing_status, razorpay_subscription_id')
    .eq('tenant_id', tenantId)
    .single();

  if (!billing?.razorpay_subscription_id) {
    return NextResponse.json({ error: 'No active subscription found.' }, { status: 404 });
  }

  if (billing.billing_status === 'cancelled' || billing.billing_status === 'completed') {
    return NextResponse.json({ error: 'Subscription is already cancelled.' }, { status: 409 });
  }

  if (['free', 'individual', 'individual_annual'].includes(billing.plan ?? '')) {
    // Non-Pro plans: cancel immediately in Razorpay
  }

  try {
    await cancelSubscription(billing.razorpay_subscription_id);
  } catch (err) {
    console.error('[Cancel Subscription] Razorpay error:', err);
    return NextResponse.json({ error: 'Failed to cancel subscription with Razorpay.' }, { status: 500 });
  }

  // Mark as cancellation_pending — stays active until period end, then webhook fires subscription.cancelled
  await supabase.from('tenant_billing').update({
    billing_status: 'cancellation_pending',
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId);

  return NextResponse.json({
    success: true,
    message: 'Your subscription will be cancelled at the end of the current billing period. You retain full access until then.',
  });
}
