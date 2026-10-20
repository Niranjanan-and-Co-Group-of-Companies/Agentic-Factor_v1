import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createSubscription, cancelSubscription } from '@/lib/services/razorpay';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// POST /api/razorpay/create-subscription
// Creates a Razorpay subscription for the authenticated tenant.
// Returns the subscription ID + short URL for checkout.
// ============================================================

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const { planId, quantity, billingPeriod } = await request.json();

    if (!planId || !['individual', 'pro', 'enterprise'].includes(planId)) {
      return NextResponse.json({ error: 'Invalid plan. Choose: individual, pro, or enterprise.' }, { status: 400 });
    }

    // Resolve to annual plan ID if requested
    const resolvedPlanId = (billingPeriod === 'annual' && planId !== 'enterprise')
      ? `${planId}_annual`
      : planId;

    // Get user email for Razorpay notifications
    const supabase = createServiceClient();
    const { data: { user } } = await supabase.auth.admin.getUserById(tenantId);
    const email = user?.email || '';

    // Check if user already has an active subscription
    const { data: billing } = await supabase
      .from('tenant_billing')
      .select('razorpay_subscription_id, plan, billing_status')
      .eq('tenant_id', tenantId)
      .single();

    // A plan bought in the app is billed by Apple or Google: subscribing here too would charge twice.
    const { data: store } = await supabase.from('tenant_billing').select('store_platform').eq('tenant_id', tenantId).maybeSingle();
    if (store?.store_platform && billing?.plan !== 'free' && ['active', 'cancellation_pending', 'past_due'].includes(billing?.billing_status ?? '')) {
      const where = store.store_platform === 'play_store' ? 'Google Play' : 'the App Store';
      return NextResponse.json(
        { error: `Your plan is billed through ${where}. Cancel it there first — it keeps running to the end of the month you paid for.` },
        { status: 409 }
      );
    }

    if (billing?.billing_status === 'active' && billing.plan !== 'free') {
      const planRank: Record<string, number> = {
        free: 0, individual: 1, individual_annual: 1, pro: 2, pro_annual: 2, enterprise: 3,
      };
      const isUpgrade = (planRank[resolvedPlanId] ?? 0) > (planRank[billing.plan] ?? 0);

      if (!isUpgrade) {
        return NextResponse.json(
          { error: 'Active subscription exists. Cancel current plan before subscribing to a new one.' },
          { status: 409 }
        );
      }

      // Upgrade path: cancel existing subscription now.
      // The subscription.cancelled webhook checks whether the cancelled sub ID
      // still matches the stored one — once we store the new ID below, the
      // webhook will skip the downgrade, so plan continuity is preserved.
      if (billing.razorpay_subscription_id) {
        try {
          await cancelSubscription(billing.razorpay_subscription_id);
        } catch (cancelErr) {
          console.warn('[Razorpay] Could not cancel old subscription during upgrade (non-fatal):', cancelErr);
        }
      }
    }

    // Create the Razorpay subscription (annual plans use resolvedPlanId)
    const result = await createSubscription(tenantId, resolvedPlanId, email, quantity || 1);

    // Store the subscription ID (status will be updated by webhook on payment)
    // UPSERT so accounts without a tenant_billing row don't silently lose this
    await supabase
      .from('tenant_billing')
      .upsert({
        tenant_id: tenantId,
        razorpay_subscription_id: result.subscriptionId,
        razorpay_plan_id: result.razorpayPlanId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' });

    return NextResponse.json({
      success: true,
      subscriptionId: result.subscriptionId,
      shortUrl: result.shortUrl,
      keyId: process.env.RAZORPAY_KEY_ID, // Frontend needs this for checkout
    });

  } catch (error) {
    console.error('[Razorpay] Create subscription failed:', error);
    return NextResponse.json(
      { error: 'Failed to create subscription', details: (error as Error).message },
      { status: 500 }
    );
  }
}
