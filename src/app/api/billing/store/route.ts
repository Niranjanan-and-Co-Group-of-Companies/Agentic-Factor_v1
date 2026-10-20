import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { ensureBillingRecord } from '@/lib/middleware/billing';
import { PLAN_CONFIGS } from '@/lib/services/plans';
import { TOPUP_PACKS } from '@/lib/services/razorpay';
import { STORE_PRODUCTS } from '@/lib/services/store-billing';
import type { StoreBillingStatus, StoreProductInfo } from '@/lib/contracts';

// GET /api/billing/store — the account's credits and plan, and where the plan is billed: what the app's
// Buy credits screen needs, and what it checks after a purchase until the store's webhook has landed.
export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const supabase = createServiceClient();
  await ensureBillingRecord(tenantId, supabase);
  const { data: b, error } = await supabase.from('tenant_billing')
    .select('plan, credits_remaining, credits_topup, billing_status, billing_period_end, is_trial, razorpay_subscription_id, store_platform, store_product_id')
    .eq('tenant_id', tenantId).maybeSingle();
  if (error || !b) return NextResponse.json({ error: error?.message ?? 'No billing record' }, { status: 500 });
  const { count: payments } = await supabase.from('billing_payments').select('payment_id', { count: 'exact', head: true }).eq('tenant_id', tenantId);

  const paying = b.plan !== 'free' && !b.is_trial && ['active', 'cancellation_pending', 'past_due', 'halted', 'pending'].includes(b.billing_status);
  const body: StoreBillingStatus = {
    plan: b.plan,
    isTrial: !!b.is_trial,
    credits: (b.credits_remaining ?? 0) + (b.credits_topup ?? 0),
    billingStatus: b.billing_status,
    periodEnd: b.billing_period_end ?? null,
    billedBy: !paying ? null : b.store_platform ?? (b.razorpay_subscription_id ? 'website' : 'other'),
    storeProductId: b.store_product_id ?? null,
    payments: payments ?? 0,
    products: Object.entries(STORE_PRODUCTS).map(([id, p]): StoreProductInfo => p.kind === 'pack'
      ? { id, kind: 'pack', name: TOPUP_PACKS[p.pack].name, credits: p.credits }
      : { id, kind: 'plan', name: p.plan === 'pro' ? 'Pro' : 'Individual', credits: PLAN_CONFIGS[p.plan].credits, maxActiveMissions: PLAN_CONFIGS[p.plan].maxActiveMissions }),
  };
  return NextResponse.json(body);
}
