-- ============================================================
-- Migration 032: Atomic Credit Deduction + Member Attribution
--
-- 1. deduct_credits_atomic() — race-condition-safe two-bucket deduction
-- 2. triggered_by_user_id on events — tracks which team member caused each credit spend
-- 3. check_and_deduct_topup_idempotent() — idempotent top-up credit grant
-- ============================================================

-- ── 1. Atomic two-bucket credit deduction ────────────────────
-- Reads AND writes in a single UPDATE; no read-then-write race.
-- Deducts from monthly credits first, then top-up bucket.
-- Returns NULL if insufficient credits or cap exceeded.

CREATE OR REPLACE FUNCTION public.deduct_credits_atomic(
  p_tenant_id           UUID,
  p_amount              INTEGER,
  p_check_monthly_cap   BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
  success               BOOLEAN,
  new_monthly           INTEGER,
  new_topup             INTEGER,
  new_used              INTEGER,
  failure_reason        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_monthly   INTEGER;
  v_topup     INTEGER;
  v_used      INTEGER;
  v_cap       INTEGER;
  v_total     INTEGER;
  v_from_m    INTEGER;
  v_from_t    INTEGER;
BEGIN
  -- Lock the row for this tenant exclusively
  SELECT credits_remaining, credits_topup, credits_used_this_month, monthly_credit_limit
    INTO v_monthly, v_topup, v_used, v_cap
    FROM public.tenant_billing
   WHERE tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 'No billing record found'::TEXT;
    RETURN;
  END IF;

  v_total := COALESCE(v_monthly, 0) + COALESCE(v_topup, 0);

  -- Monthly spending cap check (top-up bypasses cap)
  IF p_check_monthly_cap AND v_cap IS NOT NULL THEN
    IF (COALESCE(v_used, 0) + p_amount) > v_cap AND COALESCE(v_topup, 0) < p_amount THEN
      RETURN QUERY SELECT FALSE, v_monthly, v_topup, v_used,
        ('Monthly spending cap of ' || v_cap || ' credits reached (' || v_used || ' used)')::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Insufficient credits check
  IF v_total < p_amount THEN
    RETURN QUERY SELECT FALSE, v_monthly, v_topup, v_used,
      ('Insufficient credits: ' || v_total || ' available, ' || p_amount || ' needed')::TEXT;
    RETURN;
  END IF;

  -- Two-bucket deduction: monthly first, then top-up
  v_from_m := LEAST(COALESCE(v_monthly, 0), p_amount);
  v_from_t := p_amount - v_from_m;

  UPDATE public.tenant_billing SET
    credits_remaining         = COALESCE(credits_remaining, 0) - v_from_m,
    credits_topup             = COALESCE(credits_topup, 0)     - v_from_t,
    credits_used_this_month   = COALESCE(credits_used_this_month, 0) + p_amount,
    updated_at                = now()
  WHERE tenant_id = p_tenant_id;

  RETURN QUERY SELECT
    TRUE,
    (COALESCE(v_monthly, 0) - v_from_m)::INTEGER,
    (COALESCE(v_topup,   0) - v_from_t)::INTEGER,
    (COALESCE(v_used,    0) + p_amount)::INTEGER,
    NULL::TEXT;
END;
$$;

-- ── 2. Idempotent top-up credit grant ────────────────────────
-- Checks if payment_id was already processed before crediting.
-- Returns FALSE if already processed (safe to call multiple times).

CREATE OR REPLACE FUNCTION public.grant_topup_idempotent(
  p_tenant_id   UUID,
  p_payment_id  TEXT,
  p_credits     INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_already_processed BOOLEAN;
BEGIN
  -- Check if this payment was already processed
  SELECT EXISTS(
    SELECT 1 FROM public.events
     WHERE tenant_id  = p_tenant_id
       AND event_type = 'billing.topup_purchased'
       AND entity_id  = p_payment_id
  ) INTO v_already_processed;

  IF v_already_processed THEN
    RETURN FALSE; -- Already processed, skip
  END IF;

  -- Atomic credit grant
  UPDATE public.tenant_billing SET
    credits_topup = COALESCE(credits_topup, 0) + p_credits,
    updated_at    = now()
  WHERE tenant_id = p_tenant_id;

  RETURN TRUE; -- Newly processed
END;
$$;

-- ── 3. triggered_by_user_id on events ────────────────────────
-- Tracks which team member (or owner) caused each billing event.
-- NULL means the workspace owner or a system action.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS triggered_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_triggered_by
  ON public.events (tenant_id, triggered_by_user_id, event_type);
