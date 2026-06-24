-- ============================================================
-- Migration 015: Approval History
-- Run this in Supabase SQL Editor after 014
--
-- Data foundation for the Adaptive Trust Engine: every approve/reject
-- decision is recorded against a "pattern key" (tenant + agent role +
-- target service), so we can later tell when an agent has earned enough
-- consistent approvals to graduate from "always ask" to autonomous for
-- that specific kind of action — and so a single rejection can reset
-- that trust immediately.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.approval_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  proposed_action_id UUID REFERENCES public.proposed_actions(id) ON DELETE SET NULL,
  agent_id UUID,
  mission_id UUID,
  pattern_key TEXT NOT NULL,
  agent_role TEXT,
  action_type TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  edited_payload JSONB,
  decided_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_history_pattern
  ON public.approval_history(tenant_id, pattern_key, decided_at DESC);

ALTER TABLE public.approval_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own approval history"
  ON public.approval_history FOR SELECT
  USING (tenant_id = auth.uid());

-- Counts consecutive 'approved' decisions for a pattern, most-recent-first,
-- stopping at the first rejection. A rejection anywhere in the recent
-- history therefore resets the streak to 0 going forward — trust is
-- revocable, not just earned.
CREATE OR REPLACE FUNCTION public.get_approval_streak(p_tenant_id UUID, p_pattern_key TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  streak INTEGER := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT decision FROM public.approval_history
    WHERE tenant_id = p_tenant_id AND pattern_key = p_pattern_key
    ORDER BY decided_at DESC
  LOOP
    IF rec.decision = 'approved' THEN
      streak := streak + 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;
  RETURN streak;
END;
$$;
