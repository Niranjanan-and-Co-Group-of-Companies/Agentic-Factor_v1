import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createSubscription } from '@/lib/services/razorpay';
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
    const { planId, quantity } = await request.json();

    if (!planId || !['individual', 'pro', 'enterprise'].includes(planId)) {
      return NextResponse.json({ error: 'Invalid plan. Choose: individual, pro, or enterprise.' }, { status: 400 });
    }

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

    if (billing?.billing_status === 'active' && billing.plan !== 'free') {
      return NextResponse.json(
        { error: 'Active subscription exists. Cancel current plan before subscribing to a new one.' },
        { status: 409 }
      );
    }

    // Create the Razorpay subscription
    const result = await createSubscription(tenantId, planId, email, quantity || 1);

    // Store the subscription ID (status will be updated by webhook on payment)
    await supabase
      .from('tenant_billing')
      .update({
        razorpay_subscription_id: result.subscriptionId,
        razorpay_plan_id: result.razorpayPlanId,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);

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
