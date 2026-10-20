-- ============================================================
-- Buying credits and plans in the App Store and Google Play (through RevenueCat), next to the website
-- (Razorpay). Every payment is recorded once, so however often a webhook arrives it adds credits once.
-- Run after 036_lock_down_database_functions.sql.
-- ============================================================

-- 1. One row per payment that added credits or started a plan period.
CREATE TABLE IF NOT EXISTS public.billing_payments (
  payment_id   TEXT PRIMARY KEY,            -- 'razorpay:pay_…', 'app_store:<transaction id>', 'play_store:GPA.…', 'test_store:…'
  tenant_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('razorpay', 'app_store', 'play_store', 'test_store')),
  product      TEXT NOT NULL,               -- the pack or plan bought
  credits      INTEGER NOT NULL CHECK (credits >= 0),
  refunded_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_payments_tenant_idx ON public.billing_payments (tenant_id, created_at DESC);
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own payments" ON public.billing_payments;
CREATE POLICY "Users can view their own payments" ON public.billing_payments FOR SELECT USING (auth.uid() = tenant_id);

-- 2. The store a plan was bought through: null for the website (or no plan).
ALTER TABLE public.tenant_billing
  ADD COLUMN IF NOT EXISTS store_platform                TEXT,
  ADD COLUMN IF NOT EXISTS store_product_id              TEXT,
  ADD COLUMN IF NOT EXISTS store_original_transaction_id TEXT;

-- 3. billing_status allowed only active / past_due / cancelled / trialing, so every update the Razorpay
--    webhook made with cancellation_pending, halted, completed or pending failed — a cancelled website
--    subscription never moved the account to the free plan.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.tenant_billing'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%billing_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.tenant_billing DROP CONSTRAINT %I', r.conname);
  END LOOP;
END$$;
ALTER TABLE public.tenant_billing
  ADD CONSTRAINT tenant_billing_billing_status_check
  CHECK (billing_status IN ('active', 'trialing', 'pending', 'past_due', 'halted', 'cancellation_pending', 'cancelled', 'completed'));

-- 4. A credit pack: records the payment and adds its credits together. False when it was counted before.
--    (grant_topup_idempotent compared events.entity_id, a UUID, with the payment id, a text — it failed
--    on every call, so website top-ups never added their credits.)
CREATE OR REPLACE FUNCTION public.grant_purchase_credits(
  p_payment_id TEXT, p_tenant_id UUID, p_source TEXT, p_product TEXT, p_credits INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO billing_payments (payment_id, tenant_id, source, product, credits)
  VALUES (p_payment_id, p_tenant_id, p_source, p_product, p_credits)
  ON CONFLICT (payment_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE tenant_billing
     SET credits_topup = COALESCE(credits_topup, 0) + p_credits, updated_at = now()
   WHERE tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No billing record for %', p_tenant_id;
  END IF;
  RETURN TRUE;
END;
$$;

-- 5. A plan period bought in a store: records the payment and starts the period with the plan's credits.
--    p_plan: { plan, credits, max_active_missions, model_tier, max_storage_mb, governance, period_end,
--    original_transaction_id }. False when this period was started before.
CREATE OR REPLACE FUNCTION public.start_store_plan_period(
  p_payment_id TEXT, p_tenant_id UUID, p_source TEXT, p_product TEXT, p_plan JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER := (p_plan->>'credits')::INTEGER;
BEGIN
  INSERT INTO billing_payments (payment_id, tenant_id, source, product, credits)
  VALUES (p_payment_id, p_tenant_id, p_source, p_product, v_credits)
  ON CONFLICT (payment_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE tenant_billing SET
    plan                          = p_plan->>'plan',
    billing_status                = 'active',
    credits_remaining             = v_credits,
    credits_total                 = v_credits,
    credits_used_this_month       = 0,
    max_active_missions           = (p_plan->>'max_active_missions')::INTEGER,
    model_tier                    = p_plan->>'model_tier',
    max_storage_mb                = (p_plan->>'max_storage_mb')::INTEGER,
    governance                    = p_plan->>'governance',
    is_trial                      = FALSE,
    billing_period_start          = now(),
    billing_period_end            = (p_plan->>'period_end')::TIMESTAMPTZ,
    store_platform                = p_source,
    store_product_id              = p_product,
    store_original_transaction_id = p_plan->>'original_transaction_id',
    razorpay_subscription_id      = NULL,
    updated_at                    = now()
  WHERE tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No billing record for %', p_tenant_id;
  END IF;
  RETURN TRUE;
END;
$$;

-- 6. A refunded pack: takes its credits back (as far as they are unspent). Returns the credits taken, 0 if
--    already refunded or unknown.
CREATE OR REPLACE FUNCTION public.refund_purchase_credits(p_payment_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  UUID;
  v_credits INTEGER;
BEGIN
  UPDATE billing_payments SET refunded_at = now()
   WHERE payment_id = p_payment_id AND refunded_at IS NULL
  RETURNING tenant_id, credits INTO v_tenant, v_credits;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE tenant_billing
     SET credits_topup = GREATEST(0, COALESCE(credits_topup, 0) - v_credits), updated_at = now()
   WHERE tenant_id = v_tenant;
  RETURN v_credits;
END;
$$;

-- Only the server runs these.
REVOKE EXECUTE ON FUNCTION public.grant_purchase_credits(TEXT, UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_store_plan_period(TEXT, UUID, TEXT, TEXT, JSONB)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_purchase_credits(TEXT)                             FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.grant_purchase_credits(TEXT, UUID, TEXT, TEXT, INTEGER) TO service_role;
GRANT  EXECUTE ON FUNCTION public.start_store_plan_period(TEXT, UUID, TEXT, TEXT, JSONB)   TO service_role;
GRANT  EXECUTE ON FUNCTION public.refund_purchase_credits(TEXT)                             TO service_role;
