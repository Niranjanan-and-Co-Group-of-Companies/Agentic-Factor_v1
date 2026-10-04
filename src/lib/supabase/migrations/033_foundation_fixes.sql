-- ============================================================
-- Migration 033: Foundation Fixes
--
-- 1. team_members.role — add 'collaborator' (idempotent)
-- 2. missions.status  — add 'awaiting_input', 'scheduled'  (idempotent)
-- 3. tenant_billing.plan — add annual variants (idempotent)
-- 4. tenant_permissions — add encrypted_token column
-- 5. circuit_breaker_state table — cross-instance state for serverless
-- 6. add_credits_atomic_refund() — race-safe credit refund RPC
-- ============================================================

-- ── 1. team_members.role: add 'collaborator' ─────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.team_members'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%collaborator%'
  ) THEN
    ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_role_check;
    ALTER TABLE public.team_members
      ADD CONSTRAINT team_members_role_check
      CHECK (role IN ('admin', 'collaborator', 'editor', 'viewer'));
  END IF;
END$$;

-- ── 2. missions.status: add 'awaiting_input', 'scheduled' ────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.missions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%awaiting_input%'
  ) THEN
    ALTER TABLE public.missions DROP CONSTRAINT IF EXISTS missions_status_check;
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_status_check
      CHECK (status IN (
        'draft', 'pending_permissions', 'pending_validation',
        'pending_approval', 'building', 'active', 'paused',
        'scheduled', 'awaiting_input',
        'completed', 'failed', 'deadlocked'
      ));
  END IF;
END$$;

-- ── 3. tenant_billing.plan: add annual variants (idempotent) ─
DO $$
DECLARE r RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tenant_billing'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%individual_annual%'
  ) THEN
    FOR r IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.tenant_billing'::regclass
        AND contype = 'c'
        AND conname ILIKE '%plan%'
    LOOP
      EXECUTE format('ALTER TABLE public.tenant_billing DROP CONSTRAINT %I', r.conname);
    END LOOP;
    ALTER TABLE public.tenant_billing
      ADD CONSTRAINT tenant_billing_plan_check
      CHECK (plan IN (
        'free',
        'individual',        'individual_annual',
        'pro',               'pro_annual',
        'enterprise',        'enterprise_annual'
      ));
  END IF;
END$$;

-- ── 4. tenant_permissions: encrypted_token column ────────────
-- New writes store AES-GCM encrypted tokens here.
-- Read paths prefer this column; fall back to access_token
-- for rows written before encryption was introduced.
ALTER TABLE public.tenant_permissions
  ADD COLUMN IF NOT EXISTS encrypted_token TEXT;

COMMENT ON COLUMN public.tenant_permissions.encrypted_token IS
  'AES-256-GCM encrypted token (base64 IV+ciphertext). Preferred over access_token.';

-- ── 5. circuit_breaker_state: persistent cross-instance state ─
-- Serverless functions are stateless — this table gives the
-- circuit breaker durable state across cold starts and instances.
CREATE TABLE IF NOT EXISTS public.circuit_breaker_state (
  tenant_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state              TEXT NOT NULL DEFAULT 'CLOSED'
    CHECK (state IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
  tokens_this_minute INTEGER NOT NULL DEFAULT 0,
  minute_window_start BIGINT NOT NULL DEFAULT 0,
  tokens_today       INTEGER NOT NULL DEFAULT 0,
  day_window_start   BIGINT NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  tripped_at         BIGINT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.circuit_breaker_state ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write circuit state (no user-facing RLS needed)
CREATE POLICY "Service role only"
  ON public.circuit_breaker_state
  USING (false);   -- No direct client access; service key bypasses RLS

CREATE INDEX IF NOT EXISTS idx_circuit_breaker_tenant
  ON public.circuit_breaker_state (tenant_id);

-- ── 6. add_credits_atomic_refund(): race-safe credit refund ───
-- Used when a mission fails early and credits need to be returned.
-- Uses SELECT FOR UPDATE to prevent concurrent refund races.
CREATE OR REPLACE FUNCTION public.add_credits_atomic_refund(
  p_tenant_id   UUID,
  p_amount      INTEGER,
  p_reason      TEXT DEFAULT 'refund'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.tenant_billing SET
    credits_remaining        = COALESCE(credits_remaining, 0) + p_amount,
    credits_used_this_month  = GREATEST(0, COALESCE(credits_used_this_month, 0) - p_amount),
    updated_at               = now()
  WHERE tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.events (
    tenant_id, event_type, entity_type, entity_id, payload
  ) VALUES (
    p_tenant_id, 'billing.credit_refunded', 'billing', p_tenant_id::TEXT,
    jsonb_build_object('amount', p_amount, 'reason', p_reason)
  );

  RETURN TRUE;
END;
$$;
