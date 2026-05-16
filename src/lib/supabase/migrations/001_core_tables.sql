-- ============================================================
-- Migration 001: Core Tables
-- SaaS Agent Factory — v3
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- Tenants
-- ============================================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Missions
-- ============================================================
CREATE TABLE missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'pending_permissions', 'pending_validation',
      'pending_approval', 'building', 'active', 'paused',
      'completed', 'failed', 'deadlocked'
    )),
  mission_json JSONB NOT NULL,
  validation_report JSONB,
  heartbeat_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Agents (dynamic 1-N per mission)
-- ============================================================
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  service TEXT NOT NULL,
  scope TEXT NOT NULL,
  confidentiality_level TEXT NOT NULL
    CHECK (confidentiality_level IN ('public', 'internal', 'confidential', 'restricted')),
  granted BOOLEAN DEFAULT false,
  encrypted_value BYTEA,
  granted_at TIMESTAMPTZ,
  granted_by UUID
);

-- ============================================================
-- HITL Proposed Actions
-- ============================================================
CREATE TABLE proposed_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  target TEXT,
  payload JSONB,
  payload_redacted JSONB,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  is_dry_run BOOLEAN DEFAULT false,
  dry_run_result JSONB,
  reversible BOOLEAN DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'auto_approved')),
  submitted_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID,
  expires_at TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- Events (append-only audit trail)
-- ============================================================
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  actor UUID,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_missions_tenant ON missions(tenant_id);
CREATE INDEX idx_missions_status ON missions(tenant_id, status);
CREATE INDEX idx_missions_heartbeat ON missions(heartbeat_at)
  WHERE status IN ('building', 'active');
CREATE INDEX idx_agents_mission ON agents(mission_id);
CREATE INDEX idx_agents_tenant ON agents(tenant_id);
CREATE INDEX idx_actions_status ON proposed_actions(tenant_id, status);
CREATE INDEX idx_actions_mission ON proposed_actions(mission_id);
CREATE INDEX idx_events_entity ON events(tenant_id, entity_type, entity_id);
CREATE INDEX idx_permissions_mission ON permissions(mission_id);
