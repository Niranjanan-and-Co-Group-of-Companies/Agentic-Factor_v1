// Credits and plans bought in the app — App Store or Google Play, through RevenueCat. RevenueCat sends
// each purchase, renewal, cancellation, expiry and refund to /api/revenuecat/webhook; this applies it.
// The account is the RevenueCat app user id: the app logs in to RevenueCat with the Supabase user id.
// Each payment is applied once (billing_payments), however often the webhook arrives.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureBillingRecord } from '@/lib/middleware/billing';
import { PLAN_CONFIGS, freePlanFields } from './plans';
import { TOPUP_PACKS } from './razorpay';

export type StoreSource = 'app_store' | 'play_store' | 'test_store';

type StoreProduct =
  | { kind: 'pack'; pack: keyof typeof TOPUP_PACKS; credits: number }
  | { kind: 'plan'; plan: 'individual' | 'pro' };

/**
 * The products sold in the app, by store product id (the same id in the App Store, Google Play and
 * RevenueCat's Test Store). Packs give the website packs' credits; plans are monthly.
 */
export const STORE_PRODUCTS: Record<string, StoreProduct> = {
  af_credits_200:        { kind: 'pack', pack: 'starter', credits: TOPUP_PACKS.starter.credits },
  af_credits_500:        { kind: 'pack', pack: 'power',   credits: TOPUP_PACKS.power.credits },
  af_credits_1500:       { kind: 'pack', pack: 'mega',    credits: TOPUP_PACKS.mega.credits },
  af_individual_monthly: { kind: 'plan', plan: 'individual' },
  af_pro_monthly:        { kind: 'plan', plan: 'pro' },
};

/** A store product id; Google Play subscriptions arrive as "<product>:<base plan>". */
export function storeProduct(productId: string | undefined): (StoreProduct & { id: string }) | null {
  const id = (productId ?? '').split(':')[0];
  const product = STORE_PRODUCTS[id];
  return product ? { ...product, id } : null;
}

const SOURCES: Record<string, StoreSource> = {
  APP_STORE: 'app_store', MAC_APP_STORE: 'app_store', PLAY_STORE: 'play_store', TEST_STORE: 'test_store',
};

/** A RevenueCat webhook event (the fields used here). */
export interface StoreEvent {
  id: string;
  type: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
  expiration_at_ms?: number | null;
  environment?: string;
  store?: string;
  cancel_reason?: string | null;
  price?: number | null;
  currency?: string | null;
  price_in_purchased_currency?: number | null;
}

export interface StoreOutcome { result: 'applied' | 'duplicate' | 'ignored'; reason?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account a purchase belongs to: the first id that is a Supabase user id (not an anonymous one). */
export function eventTenant(e: StoreEvent): string | null {
  return [e.app_user_id, e.original_app_user_id, ...(e.aliases ?? [])].find(id => !!id && UUID.test(id)) ?? null;
}

/**
 * Applies one webhook event. Test purchases (RevenueCat's Test Store, App Store sandbox, Google test
 * cards) only count for the accounts in `sandboxTenants`: anyone can make them for free.
 */
export async function applyStoreEvent(
  supabase: SupabaseClient,
  e: StoreEvent,
  opts: { sandboxTenants: string[] },
): Promise<StoreOutcome> {
  if (e.type === 'TEST') return { result: 'ignored', reason: 'test event' };
  const tenantId = eventTenant(e);
  if (!tenantId) return { result: 'ignored', reason: 'no account id' };
  const source = SOURCES[e.store ?? ''];
  if (!source) return { result: 'ignored', reason: `store ${e.store ?? 'unknown'}` };
  if ((e.environment === 'SANDBOX' || source === 'test_store') && !opts.sandboxTenants.includes(tenantId)) {
    return { result: 'ignored', reason: 'test purchase by an account not on the test list' };
  }
  const product = storeProduct(e.product_id);
  if (!product) return { result: 'ignored', reason: `product ${e.product_id ?? 'unknown'}` };

  const paymentId = `${source}:${e.transaction_id || e.id}`;
  const price = { price: e.price_in_purchased_currency ?? null, currency: e.currency ?? null, priceUsd: e.price ?? null };
  const log = (event_type: string, payload: Record<string, unknown>) => supabase.from('events').insert({
    tenant_id: tenantId, event_type, entity_type: 'billing', entity_id: tenantId,
    payload: { source, product: product.id, eventId: e.id, ...payload },
  });

  // ── Packs: bought, or refunded ──
  if (product.kind === 'pack') {
    if (e.type === 'NON_RENEWING_PURCHASE' || e.type === 'INITIAL_PURCHASE') {
      await ensureBillingRecord(tenantId, supabase);
      const { data: granted, error } = await supabase.rpc('grant_purchase_credits', {
        p_payment_id: paymentId, p_tenant_id: tenantId, p_source: source, p_product: product.id, p_credits: product.credits,
      });
      if (error) throw new Error(`Pack ${paymentId} not credited: ${error.message}`);
      if (granted === false) return { result: 'duplicate' };
      await log('billing.topup_purchased', { paymentId, packId: product.pack, credits: product.credits, ...price });
      return { result: 'applied' };
    }
    if (e.type === 'CANCELLATION' && e.cancel_reason === 'CUSTOMER_SUPPORT') {
      const { data: taken, error } = await supabase.rpc('refund_purchase_credits', { p_payment_id: paymentId });
      if (error) throw new Error(`Refund of ${paymentId} not applied: ${error.message}`);
      if (!taken) return { result: 'duplicate' };
      await log('billing.topup_refunded', { paymentId, credits: taken });
      return { result: 'applied' };
    }
    return { result: 'ignored', reason: `${e.type} for a pack` };
  }

  // ── Plans: each paid period starts the plan with its month of credits ──
  const config = PLAN_CONFIGS[product.plan];
  if (e.type === 'INITIAL_PURCHASE' || e.type === 'RENEWAL') {
    await ensureBillingRecord(tenantId, supabase);
    const { data: started, error } = await supabase.rpc('start_store_plan_period', {
      p_payment_id: paymentId, p_tenant_id: tenantId, p_source: source, p_product: product.id,
      p_plan: {
        plan: product.plan,
        credits: config.credits,
        max_active_missions: config.maxActiveMissions,
        model_tier: config.modelTier,
        max_storage_mb: config.maxStorageMb,
        governance: config.governance,
        period_end: e.expiration_at_ms ? new Date(e.expiration_at_ms).toISOString() : null,
        original_transaction_id: e.original_transaction_id ?? e.transaction_id ?? null,
      },
    });
    if (error) throw new Error(`Plan period ${paymentId} not started: ${error.message}`);
    if (started === false) return { result: 'duplicate' };
    await log(e.type === 'RENEWAL' ? 'billing.payment_success' : 'billing.store_plan_started', { paymentId, plan: product.plan, creditsRefilled: config.credits, ...price });
    return { result: 'applied' };
  }

  // The rest concern the subscription the account's plan currently comes from — not an older one, or a
  // plan bought on the website since.
  const { data: billing } = await supabase.from('tenant_billing')
    .select('store_platform, store_product_id, store_original_transaction_id').eq('tenant_id', tenantId).maybeSingle();
  const current = !!billing?.store_platform && (
    billing.store_original_transaction_id
      ? billing.store_original_transaction_id === (e.original_transaction_id ?? e.transaction_id)
      : billing.store_product_id === product.id
  );
  if (!current) return { result: 'ignored', reason: `${e.type} for a subscription the plan no longer comes from` };

  const now = new Date().toISOString();
  switch (e.type) {
    case 'CANCELLATION':
      // Refunded: the plan ends now. Otherwise renewal is off and the plan runs to the end of its period.
      if (e.cancel_reason === 'CUSTOMER_SUPPORT') {
        await supabase.from('tenant_billing').update({ ...freePlanFields('cancelled'), store_platform: null, store_product_id: null, store_original_transaction_id: null }).eq('tenant_id', tenantId);
        await log('billing.store_plan_refunded', { plan: product.plan });
      } else {
        await supabase.from('tenant_billing').update({ billing_status: 'cancellation_pending', updated_at: now }).eq('tenant_id', tenantId);
        await log('billing.store_plan_cancelled', { plan: product.plan, reason: e.cancel_reason ?? null });
      }
      return { result: 'applied' };
    case 'UNCANCELLATION':
      await supabase.from('tenant_billing').update({ billing_status: 'active', updated_at: now }).eq('tenant_id', tenantId);
      return { result: 'applied' };
    case 'SUBSCRIPTION_EXTENDED':
      if (e.expiration_at_ms) await supabase.from('tenant_billing').update({ billing_period_end: new Date(e.expiration_at_ms).toISOString(), updated_at: now }).eq('tenant_id', tenantId);
      return { result: 'applied' };
    case 'EXPIRATION':
      await supabase.from('tenant_billing').update({ ...freePlanFields('cancelled'), store_platform: null, store_product_id: null, store_original_transaction_id: null }).eq('tenant_id', tenantId);
      await log('billing.store_plan_expired', { plan: product.plan });
      return { result: 'applied' };
    case 'BILLING_ISSUE':
      // The store keeps retrying (with a grace period); the plan ends on EXPIRATION if it never succeeds.
      await log('billing.store_billing_issue', { plan: product.plan });
      return { result: 'applied' };
    default:
      return { result: 'ignored', reason: e.type };
  }
}
