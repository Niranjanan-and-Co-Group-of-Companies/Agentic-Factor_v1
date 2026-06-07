import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createOrder } from '@/lib/services/razorpay';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// POST /api/razorpay/create-order
// Creates a Razorpay one-time order for credit top-up purchase.
// Returns orderId + keyId for frontend checkout modal.
// ============================================================

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const { packId } = await request.json();

    if (!packId || !['starter', 'power', 'mega'].includes(packId)) {
      return NextResponse.json(
        { error: 'Invalid pack. Choose: starter, power, or mega.' },
        { status: 400 }
      );
    }

    // Check user is on a paid plan (top-ups not available for free)
    const supabase = createServiceClient();
    const { data: billing } = await supabase
      .from('tenant_billing')
      .select('plan, billing_status')
      .eq('tenant_id', tenantId)
      .single();

    if (!billing || billing.plan === 'free') {
      return NextResponse.json(
        { error: 'Top-up packs are only available for Individual & Pro plans. Please upgrade first.' },
        { status: 403 }
      );
    }

    if (billing.billing_status === 'cancelled') {
      return NextResponse.json(
        { error: 'Your subscription is cancelled. Resubscribe to purchase top-ups. Your existing top-up credits are frozen and will be restored when you resubscribe.' },
        { status: 403 }
      );
    }

    // Get user email
    const { data: { user } } = await supabase.auth.admin.getUserById(tenantId);
    const email = user?.email || '';

    // Create the Razorpay order
    const result = await createOrder(tenantId, packId, email);

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      amount: result.amount,
      currency: result.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });

  } catch (error) {
    console.error('[Razorpay] Create order failed:', error);
    return NextResponse.json(
      { error: 'Failed to create order', details: (error as Error).message },
      { status: 500 }
    );
  }
}
