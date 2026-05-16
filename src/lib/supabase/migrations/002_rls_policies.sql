-- ============================================================
-- Migration 002: Row Level Security Policies
-- SaaS Agent Factory — v3
-- Primary tenant isolation wall. Every table is locked down.
-- ============================================================

-- Enable RLS on ALL tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposed_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper: extract tenant_id from JWT claims
-- ============================================================
CREATE OR REPLACE FUNCTION auth.tenant_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::UUID,
    NULL
  );
$$ LANGUAGE sql STABLE;

-- ============================================================
-- RLS Policies — one per table, all operations scoped to tenant
-- ============================================================

-- Tenants: users can only see their own tenant
CREATE POLICY tenant_isolation ON tenants
  FOR ALL USING (id = auth.tenant_id());

-- Missions: scoped by tenant_id
CREATE POLICY mission_isolation ON missions
  FOR ALL USING (tenant_id = auth.tenant_id());

-- Agents: scoped by tenant_id
CREATE POLICY agent_isolation ON agents
  FOR ALL USING (tenant_id = auth.tenant_id());

-- Permissions: scoped by tenant_id
CREATE POLICY permission_isolation ON permissions
  FOR ALL USING (tenant_id = auth.tenant_id());

-- Proposed Actions: scoped by tenant_id
CREATE POLICY action_isolation ON proposed_actions
  FOR ALL USING (tenant_id = auth.tenant_id());

-- Events: scoped by tenant_id
CREATE POLICY event_isolation ON events
  FOR ALL USING (tenant_id = auth.tenant_id());
