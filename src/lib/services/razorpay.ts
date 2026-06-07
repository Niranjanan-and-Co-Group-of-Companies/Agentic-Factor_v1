import Razorpay from 'razorpay';
import crypto from 'crypto';

// ============================================================
// Razorpay Service — Subscription & Payment Management
// Handles plan creation, subscription lifecycle, and webhook
// verification for the Agentic Factor billing system.
// ============================================================

let _instance: InstanceType<typeof Razorpay> | null = null;

function getRazorpay(): InstanceType<typeof Razorpay> {
  if (!_instance) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set');
    }
    _instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return _instance;
}

// ── Plan configuration (create these in Razorpay Dashboard) ──
export const RAZORPAY_PLANS = {
  individual: {
    name: 'Individual',
    priceInr: 2499,
    interval: 'monthly',
    description: '20 missions/mo, 5 agents/mission, 200K tokens/day',
  },
  pro: {
    name: 'Pro (Per Seat)',
    priceInr: 1249,
    interval: 'monthly',
    description: '100 missions/mo, 15 agents/mission, 500K tokens/day',
  },
  enterprise: {
    name: 'Enterprise',
    priceInr: 0, // Custom pricing
    interval: 'monthly',
    description: 'Unlimited everything. Contact sales.',
  },
} as const;

/**
 * Create a Razorpay subscription for a tenant.
 * Pro plan: ₹2,299 base + ₹2,249/seat (base added as recurring addon).
 * Individual plan: flat ₹2,499/month.
 */
export async function createSubscription(
  tenantId: string,
  planId: string,
  email: string,
  quantity: number = 1
): Promise<{
  subscriptionId: string;
  shortUrl: string;
  razorpayPlanId: string;
}> {
  const razorpay = getRazorpay();
  const razorpayPlanId = process.env[`RAZORPAY_PLAN_${planId.toUpperCase()}`];

  if (!razorpayPlanId) {
    throw new Error(`No Razorpay plan ID configured for plan: ${planId}. Set RAZORPAY_PLAN_${planId.toUpperCase()} env var.`);
  }

  const subscription = await razorpay.subscriptions.create({
    plan_id: razorpayPlanId,
    total_count: 12, // 12 billing cycles
    quantity: planId === 'pro' ? quantity : 1,
    notes: {
      tenant_id: tenantId,
      plan: planId,
      email,
    },
    notify_info: {
      notify_email: email,
    },
  } as any);

  // Pro plan: Add ₹2,299 recurring base fee as an addon
  if (planId === 'pro') {
    try {
      await (razorpay.subscriptions as any).createAddon(subscription.id, {
        item: {
          name: 'Pro Base Fee',
          amount: 229900, // ₹2,299 in paise
          currency: 'INR',
        },
        quantity: 1,
      });
      console.log(`[Razorpay] Added ₹2,299 base addon to Pro subscription ${subscription.id}`);
    } catch (addonErr) {
      console.warn('[Razorpay] Failed to add base addon (non-fatal):', addonErr);
    }
  }

  return {
    subscriptionId: subscription.id,
    shortUrl: (subscription as any).short_url || '',
    razorpayPlanId,
  };
}

/**
 * Cancel a Razorpay subscription.
 */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const razorpay = getRazorpay();
  await razorpay.subscriptions.cancel(subscriptionId, false); // false = cancel at end of period
}

/**
 * Fetch subscription details from Razorpay.
 */
export async function getSubscription(subscriptionId: string): Promise<any> {
  const razorpay = getRazorpay();
  return await razorpay.subscriptions.fetch(subscriptionId);
}

/**
 * Verify Razorpay webhook signature.
 * CRITICAL: Never process webhooks without verifying signature.
 */
export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Razorpay] RAZORPAY_WEBHOOK_SECRET not set');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Map a Razorpay plan ID back to our internal plan name.
 */
export function resolvePlanName(razorpayPlanId: string): string {
  const envMap: Record<string, string> = {
    [process.env.RAZORPAY_PLAN_INDIVIDUAL || '']: 'individual',
    [process.env.RAZORPAY_PLAN_PRO || '']: 'pro',
    [process.env.RAZORPAY_PLAN_ENTERPRISE || '']: 'enterprise',
  };
  return envMap[razorpayPlanId] || 'free';
}

// ── Top-Up Pack Configurations ──
export const TOPUP_PACKS: Record<string, { credits: number; amountPaisa: number; name: string }> = {
  starter: { credits: 200,  amountPaisa: 59900,  name: 'Starter Pack' },
  power:   { credits: 500,  amountPaisa: 129900, name: 'Power Pack' },
  mega:    { credits: 1500, amountPaisa: 349900, name: 'Mega Pack' },
};

/**
 * Create a Razorpay one-time order for credit top-up purchase.
 * Returns orderId for frontend checkout.
 */
export async function createOrder(
  tenantId: string,
  packId: string,
  email: string
): Promise<{ orderId: string; amount: number; currency: string }> {
  const razorpay = getRazorpay();
  const pack = TOPUP_PACKS[packId];

  if (!pack) {
    throw new Error(`Invalid top-up pack: ${packId}. Valid packs: ${Object.keys(TOPUP_PACKS).join(', ')}`);
  }

  const order = await razorpay.orders.create({
    amount: pack.amountPaisa,
    currency: 'INR',
    receipt: `topup_${tenantId}_${packId}_${Date.now()}`,
    notes: {
      tenant_id: tenantId,
      pack_id: packId,
      pack_credits: String(pack.credits),
      email,
      type: 'topup',
    },
  });

  return {
    orderId: order.id,
    amount: pack.amountPaisa,
    currency: 'INR',
  };
}
