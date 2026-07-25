-- ============================================================
-- Migration 024: Mission Versioning
--
-- Every time a mission blueprint is saved or edited, a snapshot
-- is written here. Users can browse history and restore any
-- prior version with one click.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mission_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     UUID NOT NULL,
  tenant_id      UUID NOT NULL,
  version_number INTEGER NOT NULL,
  mission_json   JSONB NOT NULL,
  change_summary TEXT NOT NULL DEFAULT 'Blueprint saved',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(mission_id, version_number)
);

ALTER TABLE public.mission_versions ENABLE ROW LEVEL SECURITY;

-- Team members can read version history
DROP POLICY IF EXISTS "Tenants see own versions" ON public.mission_versions;
CREATE POLICY "Tenants see own versions" ON public.mission_versions
  FOR SELECT USING (public.team_has_access(tenant_id));

-- Only the owner can create/delete versions
DROP POLICY IF EXISTS "Only owners write versions" ON public.mission_versions;
CREATE POLICY "Only owners write versions" ON public.mission_versions
  FOR ALL USING (tenant_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_mission_versions_mission
  ON public.mission_versions(mission_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_mission_versions_tenant
  ON public.mission_versions(tenant_id);
