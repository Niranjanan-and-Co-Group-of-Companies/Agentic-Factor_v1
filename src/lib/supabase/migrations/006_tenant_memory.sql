-- ============================================================
-- Migration 006: Tenant Global Memory
-- SaaS Agent Factory — v3
-- Stores persistent facts and policies extracted from user chats
-- ============================================================

CREATE TABLE tenant_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  fact TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS on tenant memory
ALTER TABLE tenant_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own memory" ON tenant_memory
  FOR SELECT USING (tenant_id = auth.uid());
CREATE POLICY "Users insert own memory" ON tenant_memory
  FOR INSERT WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Users update own memory" ON tenant_memory
  FOR UPDATE USING (tenant_id = auth.uid());

-- Index for fast retrieval
CREATE INDEX idx_tenant_memory_tenant ON tenant_memory(tenant_id);
