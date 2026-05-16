-- ============================================================
-- Migration 005: Snapshots & Deadlock Detection
-- SaaS Agent Factory — v3
-- State versioning (undo button) + deadlock detection helper.
-- ============================================================

-- ============================================================
-- State Versioning: Mission Snapshots
-- Every successful state transition captures a full JSONB
-- snapshot of the entire agentic state (mission + agents + actions).
-- ============================================================
CREATE TABLE mission_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  trigger_status TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(mission_id, version)
);

-- RLS on snapshots
ALTER TABLE mission_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY snapshot_isolation ON mission_snapshots
  FOR ALL USING (tenant_id = auth.tenant_id());

-- Fast lookup: latest snapshots per mission
CREATE INDEX idx_snapshots_mission ON mission_snapshots(mission_id, version DESC);
CREATE INDEX idx_snapshots_tenant ON mission_snapshots(tenant_id);

-- ============================================================
-- Deadlock Detection Function
-- Returns all missions that have been idle longer than their
-- configured timeout_seconds (default 300s).
-- Called by the DeadlockDetector supervisor service.
-- ============================================================
CREATE OR REPLACE FUNCTION detect_deadlocked_missions()
RETURNS TABLE (
  mission_id UUID,
  tenant_id UUID,
  idle_seconds INTEGER,
  timeout_seconds INTEGER
) AS $$
  SELECT
    m.id AS mission_id,
    m.tenant_id,
    EXTRACT(EPOCH FROM (now() - m.heartbeat_at))::INTEGER AS idle_seconds,
    COALESCE(
      (m.mission_json -> 'orchestration' ->> 'timeoutSeconds')::INTEGER,
      300
    ) AS timeout_seconds
  FROM missions m
  WHERE m.status IN ('building', 'active')
    AND m.heartbeat_at < now() - (
      COALESCE(
        (m.mission_json -> 'orchestration' ->> 'timeoutSeconds')::INTEGER,
        300
      ) || ' seconds'
    )::interval;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- Get next snapshot version for a mission
-- ============================================================
CREATE OR REPLACE FUNCTION get_next_snapshot_version(p_mission_id UUID)
RETURNS INTEGER AS $$
  SELECT COALESCE(MAX(version), 0) + 1
  FROM mission_snapshots
  WHERE mission_id = p_mission_id;
$$ LANGUAGE sql STABLE;
