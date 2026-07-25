-- ============================================================
-- Migration 022: Spending limits & monthly credit cap
-- Adds optional monthly_credit_limit to tenant_billing so
-- users can set a hard cap on credit spend per month.
-- NULL = no limit (default).
-- ============================================================

ALTER TABLE public.tenant_billing
    ADD COLUMN IF NOT EXISTS monthly_credit_limit INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.tenant_billing.monthly_credit_limit IS
  'Optional hard cap on credits per billing period. NULL = no cap.';
