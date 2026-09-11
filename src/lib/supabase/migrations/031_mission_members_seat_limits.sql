-- ============================================================
-- Migration 031: Mission-Level Members + Seat Limits
--
-- Adds:
-- 1. mission_members — per-mission invite table (Option A: mission-level access)
-- 2. mission_has_access() — extends RLS to include mission-level members
-- 3. get_seat_count() — counts unique invited emails for seat limit enforcement
-- 4. team_members role: adds 'collaborator' alongside existing roles
-- ============================================================

-- ── 1. Add 'collaborator' role to workspace team_members ─────

ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_role_check;
ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_role_check
  CHECK (role IN ('admin', 'collaborator', 'editor', 'viewer'));

-- ── 2. mission_members table (Option A: mission-only access) ─

CREATE TABLE IF NOT EXISTS public.mission_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  owner_tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_email    TEXT NOT NULL,
  member_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role            TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('collaborator', 'viewer')),
  invite_token    TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at     TIMESTAMPTZ,
  UNIQUE(mission_id, member_email)
);

ALTER TABLE public.mission_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Mission owners can manage mission members"
  ON public.mission_members
  FOR ALL
  USING (owner_tenant_id = auth.uid());

CREATE POLICY "Mission members can see their own memberships"
  ON public.mission_members
  FOR SELECT
  USING (member_user_id = auth.uid());

-- ── 3. mission_has_access() — workspace OR mission membership ─

CREATE OR REPLACE FUNCTION public.mission_has_access(p_mission_id UUID, p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT
    -- Owner
    p_tenant_id = auth.uid()
    -- Workspace-level member
    OR public.team_has_access(p_tenant_id)
    -- Mission-level member
    OR EXISTS (
      SELECT 1 FROM public.mission_members
      WHERE mission_id      = p_mission_id
        AND member_user_id  = auth.uid()
        AND status          = 'accepted'
    );
$$;

-- Update the missions SELECT policy to use the new helper
DROP POLICY IF EXISTS "Team members can view missions" ON public.missions;
CREATE POLICY "Team members can view missions" ON public.missions
  FOR SELECT USING (public.mission_has_access(id, tenant_id));

-- Extend other tables so mission members can read run data for their mission
DROP POLICY IF EXISTS "Team members can view mission runs" ON public.mission_runs;
CREATE POLICY "Team members can view mission runs" ON public.mission_runs
  FOR SELECT USING (
    public.team_has_access(tenant_id)
    OR EXISTS (
      SELECT 1 FROM public.mission_members mm
      WHERE mm.mission_id     = mission_runs.mission_id
        AND mm.member_user_id = auth.uid()
        AND mm.status         = 'accepted'
    )
  );

-- ── 4. get_seat_count() — unique emails across both tables ─────
-- Used by the API to enforce Pro plan 25-seat limit.

CREATE OR REPLACE FUNCTION public.get_seat_count(p_owner_tenant_id UUID)
RETURNS INTEGER
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT COUNT(DISTINCT member_email)::INTEGER
  FROM (
    SELECT member_email FROM public.team_members
    WHERE owner_tenant_id = p_owner_tenant_id
      AND status != 'revoked'
    UNION
    SELECT member_email FROM public.mission_members
    WHERE owner_tenant_id = p_owner_tenant_id
      AND status != 'revoked'
  ) combined;
$$;

-- Realtime for mission_members (so mission invite UI updates live)
ALTER PUBLICATION supabase_realtime ADD TABLE public.mission_members;
