-- ============================================================
-- Migration: Standalone Tables (No FK to tenants)
-- SaaS Agent Factory — Production-Ready
--
-- Uses auth.users UUID directly as tenant_id.
-- No separate tenants table required.
-- Run this in Supabase SQL Editor.
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Missions
-- ============================================================
CREATE TABLE IF NOT EXISTS missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'pending_permissions', 'pending_validation',
      'pending_approval', 'building', 'active', 'paused',
      'completed', 'failed', 'deadlocked'
    )),
  mission_json JSONB NOT NULL DEFAULT '{}',
  validation_report JSONB,
  heartbeat_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Agents (dynamic 1-N per mission)
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  agent_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'inactive'
    CHECK (status IN (
      'inactive', 'spawning', 'running', 'paused',
      'completed', 'failed', 'terminated', 'deadlocked'
    )),
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  requires_external_data BOOLEAN DEFAULT false,
  system_prompt TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Permissions
-- ============================================================
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  service TEXT NOT NULL,
  scope TEXT NOT NULL,
  confidentiality_level TEXT NOT NULL DEFAULT 'internal',
  granted BOOLEAN DEFAULT false,
  encrypted_value BYTEA,
  granted_at TIMESTAMPTZ,
  granted_by UUID
);

-- ============================================================
-- HITL Proposed Actions
-- ============================================================
CREATE TABLE IF NOT EXISTS proposed_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
  agent_id UUID,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  target TEXT,
  payload JSONB,
  payload_redacted JSONB,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  is_dry_run BOOLEAN DEFAULT false,
  dry_run_result JSONB,
  reversible BOOLEAN DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'auto_approved')),
  submitted_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '1 hour')
);

-- ============================================================
-- Events (append-only audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  actor UUID,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Clarifications (Ask-Back Queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS clarifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
  agent_id UUID,
  question TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'answered', 'expired')),
  created_at TIMESTAMPTZ DEFAULT now(),
  answered_at TIMESTAMPTZ
);

-- ============================================================
-- Mission Snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS mission_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  trigger TEXT NOT NULL,
  snapshot_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_missions_tenant ON missions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_mission ON agents(mission_id);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_actions_status ON proposed_actions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(tenant_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_permissions_mission ON permissions(mission_id);
CREATE INDEX IF NOT EXISTS idx_clarifications_tenant ON clarifications(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_snapshots_mission ON mission_snapshots(mission_id);

-- ============================================================
-- Row Level Security (RLS)
-- Each user can only access their own tenant_id = auth.uid()
-- ============================================================
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposed_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE clarifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_snapshots ENABLE ROW LEVEL SECURITY;

-- Policies for missions
CREATE POLICY "Users see own missions" ON missions
  FOR SELECT USING (tenant_id = auth.uid());
CREATE POLICY "Users insert own missions" ON missions
  FOR INSERT WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Users update own missions" ON missions
  FOR UPDATE USING (tenant_id = auth.uid());

-- Policies for agents
CREATE POLICY "Users see own agents" ON agents
  FOR SELECT USING (tenant_id = auth.uid());
CREATE POLICY "Users insert own agents" ON agents
  FOR INSERT WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Users update own agents" ON agents
  FOR UPDATE USING (tenant_id = auth.uid());

-- Policies for permissions
CREATE POLICY "Users see own permissions" ON permissions
  FOR SELECT USING (tenant_id = auth.uid());
CREATE POLICY "Users insert own permissions" ON permissions
  FOR INSERT WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Users update own permissions" ON permissions
  FOR UPDATE USING (tenant_id = auth.uid());

-- Policies for proposed_actions
CREATE POLICY "Users see own actions" ON proposed_actions
  FOR SELECT USING (tenant_id = auth.uid());
CREATE POLICY "Users insert own actions" ON proposed_actions
  FOR INSERT WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Users update own actions" ON proposed_actions
  FOR UPDATE USING (tenant_id = auth.uid());

-- Policies for events
CREATE POLICY "Users see own events" ON events
  FOR SELECT USING (tenant_id = auth.uid());
CREATE POLICY "Users insert own events" ON events
  FOR INSERT WITH CHECK (tenant_id = auth.uid());

-- Policies for clarifications
CREATE POLICY "Users see own clarifications" ON clarifications
  FOR SELECT USING (tenant_id = auth.uid());
CREATE POLICY "Users insert own clarifications" ON clarifications
  FOR INSERT WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Users update own clarifications" ON clarifications
  FOR UPDATE USING (tenant_id = auth.uid());

-- Policies for snapshots
CREATE POLICY "Users see own snapshots" ON mission_snapshots
  FOR SELECT USING (tenant_id = auth.uid());
CREATE POLICY "Users insert own snapshots" ON mission_snapshots
  FOR INSERT WITH CHECK (tenant_id = auth.uid());

-- ============================================================
-- Service role bypass (for backend API calls)
-- The service_role key bypasses RLS automatically in Supabase.
-- No additional policy needed.
-- ============================================================
