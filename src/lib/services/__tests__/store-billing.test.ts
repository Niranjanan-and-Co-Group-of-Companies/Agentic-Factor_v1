/* eslint-disable @typescript-eslint/no-explicit-any -- a deliberately loose stand-in for the Supabase client */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyStoreEvent, eventTenant, storeProduct, type StoreEvent } from '../store-billing';

// ── In-memory Supabase: tenant_billing, events, and the three SQL functions of 037_store_purchases ──
type Row = Record<string, any>;
let db: { tenant_billing: Row[]; events: Row[]; billing_payments: Row[] };

function from(table: keyof typeof db) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' | 'insert' = 'select';
  let patch: Row = {};
  const run = () => db[table].filter(r => filters.every(f => f(r)));
  const q: any = {
    select() { return q; },
    insert(row: Row) { db[table].push({ ...row }); op = 'insert'; return q; },
    update(p: Row) { op = 'update'; patch = p; return q; },
    eq(c: string, v: unknown) { filters.push(r => r[c] === v); return q; },
    maybeSingle() { return Promise.resolve({ data: run()[0] ?? null, error: null }); },
    single() { const r = run()[0]; return Promise.resolve({ data: r ?? null, error: r ? null : { message: 'no rows' } }); },
    then(res: any, rej: any) {
      if (op === 'update') run().forEach(r => Object.assign(r, patch));
      return Promise.resolve({ data: op === 'select' ? run() : null, error: null }).then(res, rej);
    },
  };
  return q;
}

const billingOf = (t: string) => db.tenant_billing.find(b => b.tenant_id === t)!;
const rpc = async (fn: string, a: Row) => {
  if (fn === 'grant_purchase_credits' || fn === 'start_store_plan_period') {
    if (db.billing_payments.some(p => p.payment_id === a.p_payment_id)) return { data: false, error: null };
    const credits = fn === 'grant_purchase_credits' ? a.p_credits : a.p_plan.credits;
    db.billing_payments.push({ payment_id: a.p_payment_id, tenant_id: a.p_tenant_id, credits, refunded_at: null });
    const b = billingOf(a.p_tenant_id);
    if (fn === 'grant_purchase_credits') b.credits_topup += credits;
    else Object.assign(b, {
      plan: a.p_plan.plan, billing_status: 'active', credits_remaining: credits, credits_total: credits,
      billing_period_end: a.p_plan.period_end, store_platform: a.p_source, store_product_id: a.p_product,
      store_original_transaction_id: a.p_plan.original_transaction_id, razorpay_subscription_id: null,
    });
    return { data: true, error: null };
  }
  if (fn === 'refund_purchase_credits') {
    const p = db.billing_payments.find(x => x.payment_id === a.p_payment_id && !x.refunded_at);
    if (!p) return { data: 0, error: null };
    p.refunded_at = 'now';
    const b = billingOf(p.tenant_id);
    b.credits_topup = Math.max(0, b.credits_topup - p.credits);
    return { data: p.credits, error: null };
  }
  throw new Error(`unexpected rpc ${fn}`);
};
const supabase = { from, rpc } as any;

const T = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const opts = { sandboxTenants: [T] };
const ev = (e: Partial<StoreEvent>): StoreEvent => ({ id: `evt-${Math.random()}`, type: 'NON_RENEWING_PURCHASE', app_user_id: T, store: 'APP_STORE', environment: 'PRODUCTION', ...e });

beforeEach(() => {
  db = {
    tenant_billing: [
      { tenant_id: T, plan: 'free', billing_status: 'active', credits_remaining: 30, credits_topup: 0, credits_total: 30 },
      { tenant_id: STRANGER, plan: 'free', billing_status: 'active', credits_remaining: 30, credits_topup: 0, credits_total: 30 },
    ],
    events: [],
    billing_payments: [],
  };
});

describe('credit packs', () => {
  it('adds a pack once, however often the webhook arrives', async () => {
    const buy = ev({ product_id: 'af_credits_500', transaction_id: 'tx-1' });
    expect(await applyStoreEvent(supabase, buy, opts)).toEqual({ result: 'applied' });
    expect(await applyStoreEvent(supabase, { ...buy, id: 'retry' }, opts)).toEqual({ result: 'duplicate' });
    expect(billingOf(T).credits_topup).toBe(500);
    expect(db.events.filter(e => e.event_type === 'billing.topup_purchased')).toHaveLength(1);
  });

  it('takes a refunded pack back, once', async () => {
    await applyStoreEvent(supabase, ev({ product_id: 'af_credits_200', transaction_id: 'tx-2' }), opts);
    const refund = ev({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', product_id: 'af_credits_200', transaction_id: 'tx-2' });
    expect(await applyStoreEvent(supabase, refund, opts)).toEqual({ result: 'applied' });
    expect(await applyStoreEvent(supabase, refund, opts)).toEqual({ result: 'duplicate' });
    expect(billingOf(T).credits_topup).toBe(0);
  });

  it('ignores test purchases by accounts not on the test list — anyone can make them for free', async () => {
    const fake = ev({ app_user_id: STRANGER, store: 'TEST_STORE', product_id: 'af_credits_1500', transaction_id: 'tx-3' });
    expect((await applyStoreEvent(supabase, fake, opts)).result).toBe('ignored');
    expect((await applyStoreEvent(supabase, { ...fake, store: 'APP_STORE', environment: 'SANDBOX' }, opts)).result).toBe('ignored');
    expect(billingOf(STRANGER).credits_topup).toBe(0);
    expect((await applyStoreEvent(supabase, { ...fake, app_user_id: T }, opts)).result).toBe('applied');
    expect(billingOf(T).credits_topup).toBe(1500);
  });

  it('ignores unknown products and events without an account', async () => {
    expect((await applyStoreEvent(supabase, ev({ product_id: 'something_else' }), opts)).result).toBe('ignored');
    expect((await applyStoreEvent(supabase, ev({ app_user_id: '$RCAnonymousID:abc', product_id: 'af_credits_200' }), opts)).result).toBe('ignored');
  });
});

describe('monthly plans', () => {
  const sub = (e: Partial<StoreEvent>) => ev({ product_id: 'af_pro_monthly', original_transaction_id: 'orig-1', expiration_at_ms: Date.UTC(2026, 10, 20), ...e });

  it('starts the plan, refills each renewal once, and runs to the end of the month after a cancellation', async () => {
    expect(await applyStoreEvent(supabase, sub({ type: 'INITIAL_PURCHASE', transaction_id: 'p1' }), opts)).toEqual({ result: 'applied' });
    expect(billingOf(T)).toMatchObject({ plan: 'pro', credits_remaining: 2500, store_platform: 'app_store', store_product_id: 'af_pro_monthly' });

    billingOf(T).credits_remaining = 100; // used during the month
    expect(await applyStoreEvent(supabase, sub({ type: 'RENEWAL', transaction_id: 'p2' }), opts)).toEqual({ result: 'applied' });
    expect(billingOf(T).credits_remaining).toBe(2500);
    billingOf(T).credits_remaining = 100;
    expect(await applyStoreEvent(supabase, sub({ type: 'RENEWAL', transaction_id: 'p2', id: 'retry' }), opts)).toEqual({ result: 'duplicate' });
    expect(billingOf(T).credits_remaining).toBe(100);

    await applyStoreEvent(supabase, sub({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' }), opts);
    expect(billingOf(T)).toMatchObject({ plan: 'pro', billing_status: 'cancellation_pending' });
    await applyStoreEvent(supabase, sub({ type: 'UNCANCELLATION' }), opts);
    expect(billingOf(T).billing_status).toBe('active');

    await applyStoreEvent(supabase, sub({ type: 'EXPIRATION' }), opts);
    expect(billingOf(T)).toMatchObject({ plan: 'free', billing_status: 'cancelled', store_platform: null });
  });

  it('reads Google Play subscription ids with their base plan', async () => {
    expect(storeProduct('af_individual_monthly:monthly')).toMatchObject({ kind: 'plan', plan: 'individual' });
    await applyStoreEvent(supabase, ev({ type: 'INITIAL_PURCHASE', store: 'PLAY_STORE', product_id: 'af_individual_monthly:monthly', transaction_id: 'GPA.1', original_transaction_id: 'GPA.1' }), opts);
    expect(billingOf(T)).toMatchObject({ plan: 'individual', credits_remaining: 1000, store_platform: 'play_store' });
  });

  it('leaves a website plan alone when an old store subscription expires', async () => {
    await applyStoreEvent(supabase, sub({ type: 'INITIAL_PURCHASE', transaction_id: 'p1' }), opts);
    Object.assign(billingOf(T), { plan: 'individual', store_platform: null, store_product_id: null, store_original_transaction_id: null, razorpay_subscription_id: 'sub_web' });
    expect((await applyStoreEvent(supabase, sub({ type: 'EXPIRATION' }), opts)).result).toBe('ignored');
    expect(billingOf(T).plan).toBe('individual');
  });

  it('ends the plan at once when a subscription is refunded', async () => {
    await applyStoreEvent(supabase, sub({ type: 'INITIAL_PURCHASE', transaction_id: 'p1' }), opts);
    await applyStoreEvent(supabase, sub({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' }), opts);
    expect(billingOf(T)).toMatchObject({ plan: 'free', billing_status: 'cancelled' });
  });
});

describe('the account of an event', () => {
  it('is the first Supabase user id among the RevenueCat ids', () => {
    expect(eventTenant({ id: '1', type: 'X', app_user_id: '$RCAnonymousID:x', aliases: ['$RCAnonymousID:x', T] })).toBe(T);
    expect(eventTenant({ id: '1', type: 'X', app_user_id: 'not-a-user' })).toBeNull();
  });
});
