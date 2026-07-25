-- ============================================================
-- Migration 023: Team RBAC
--
-- Adds team membership so Pro/Enterprise customers can invite
-- colleagues to view or operate their missions.
--
-- Architecture: tenant_id stays = auth.users.id (no breaking change).
-- A helper function team_has_access() extends SELECT policies so
-- accepted team members can read the owner's resources.
-- Write operations (INSERT/UPDATE/DELETE) remain owner-only.
-- ============================================================

-- ── team_members table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.team_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_email    TEXT NOT NULL,
  member_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role            TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('admin', 'editor', 'viewer')),
  invite_token    TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at     TIMESTAMPTZ,
  UNIQUE(owner_tenant_id, member_email)
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team owners can manage members" ON public.team_members;
CREATE POLICY "Team owners can manage members" ON public.team_members
  FOR ALL USING (owner_tenant_id = auth.uid());

DROP POLICY IF EXISTS "Members can see their own memberships" ON public.team_members;
CREATE POLICY "Members can see their own memberships" ON public.team_members
  FOR SELECT USING (member_user_id = auth.uid());

-- ── team_has_access helper function ──────────────────────────
-- Returns TRUE if the current user IS the tenant owner,
-- or is an accepted member of that tenant's team.
-- SECURITY DEFINER so it can read team_members without RLS interference.

CREATE OR REPLACE FUNCTION public.team_has_access(resource_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT
    resource_tenant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.team_members
      WHERE owner_tenant_id = resource_tenant_id
        AND member_user_id  = auth.uid()
        AND status          = 'accepted'
    );
$$;

-- ── Extend SELECT policies on key tables ─────────────────────
-- Adds team member read access WITHOUT removing owner write access.

DROP POLICY IF EXISTS "Team members can view missions" ON public.missions;
CREATE POLICY "Team members can view missions" ON public.missions
  FOR SELECT USING (public.team_has_access(tenant_id));

DROP POLICY IF EXISTS "Team members can view mission runs" ON public.mission_runs;
CREATE POLICY "Team members can view mission runs" ON public.mission_runs
  FOR SELECT USING (public.team_has_access(tenant_id));

DROP POLICY IF EXISTS "Team members can view agents" ON public.agents;
CREATE POLICY "Team members can view agents" ON public.agents
  FOR SELECT USING (public.team_has_access(tenant_id));
