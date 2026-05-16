-- ============================================================
-- Migration 004: Helper Functions
-- SaaS Agent Factory — v3
-- Utility functions used by application services.
-- ============================================================

-- ============================================================
-- Auto-update updated_at on missions
-- ============================================================
CREATE OR REPLACE FUNCTION update_mission_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mission_updated_at
  BEFORE UPDATE ON missions
  FOR EACH ROW
  EXECUTE FUNCTION update_mission_timestamp();

-- ============================================================
-- Update heartbeat on mission (called by agents during execution)
-- ============================================================
CREATE OR REPLACE FUNCTION touch_heartbeat(p_mission_id UUID)
RETURNS VOID AS $$
  UPDATE missions
  SET heartbeat_at = now()
  WHERE id = p_mission_id;
$$ LANGUAGE sql VOLATILE SECURITY DEFINER;

-- ============================================================
-- Get mission statistics for a tenant
-- ============================================================
CREATE OR REPLACE FUNCTION get_tenant_stats(p_tenant_id UUID)
RETURNS TABLE (
  total_missions BIGINT,
  active_missions BIGINT,
  pending_approvals BIGINT,
  total_agents BIGINT
) AS $$
  SELECT
    (SELECT COUNT(*) FROM missions WHERE tenant_id = p_tenant_id),
    (SELECT COUNT(*) FROM missions WHERE tenant_id = p_tenant_id AND status IN ('building', 'active')),
    (SELECT COUNT(*) FROM proposed_actions WHERE tenant_id = p_tenant_id AND status = 'pending'),
    (SELECT COUNT(*) FROM agents WHERE tenant_id = p_tenant_id AND status = 'running');
$$ LANGUAGE sql STABLE SECURITY DEFINER;
