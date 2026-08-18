-- ============================================================
-- Fix billing constraint violations introduced by Razorpay
-- annual plan support and top-up credit system.
-- ============================================================

-- 1. Add credits_topup column (top-up credit packs, never expire)
ALTER TABLE public.tenant_billing
  ADD COLUMN IF NOT EXISTS credits_topup INTEGER NOT NULL DEFAULT 0;

-- 2. Expand `plan` CHECK to include annual variants
--    PostgreSQL auto-names inline CHECK constraints as <table>_<col>_check
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.tenant_billing'::regclass
      AND contype = 'c'
      AND conname ILIKE '%plan%'
  LOOP
    EXECUTE format('ALTER TABLE public.tenant_billing DROP CONSTRAINT %I', r.conname);
  END LOOP;
END$$;

ALTER TABLE public.tenant_billing
  ADD CONSTRAINT tenant_billing_plan_check
  CHECK (plan IN (
    'free',
    'individual', 'individual_annual',
    'pro',        'pro_annual',
    'enterprise', 'enterprise_annual'
  ));

-- 3. Rename the duplicate 012_scheduling migration file is a manual step —
--    the file is tracked in git; run the following once in your shell:
--    git mv src/lib/supabase/migrations/012_scheduling.sql \
--            src/lib/supabase/migrations/013_scheduling.sql
--    The scheduling migration content is idempotent (IF NOT EXISTS / IF EXISTS),
--    so re-running it under the new name is safe.
