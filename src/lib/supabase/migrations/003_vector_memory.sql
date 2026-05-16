-- ============================================================
-- Migration 003: Vector Memory (pgvector)
-- SaaS Agent Factory — v3
-- Stores embeddings of successful mission patterns for
-- similarity-based few-shot retrieval during intake.
-- ============================================================

-- Mission memory table with vector column
CREATE TABLE mission_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  embedding VECTOR(1536) NOT NULL,
  pattern_summary TEXT NOT NULL,
  mission_type TEXT NOT NULL,
  agent_count INTEGER NOT NULL,
  orchestration_pattern TEXT NOT NULL,
  success_score FLOAT DEFAULT 1.0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS on vector memory
ALTER TABLE mission_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY memory_isolation ON mission_memory
  FOR ALL USING (tenant_id = auth.tenant_id());

-- HNSW index for fast cosine similarity search
CREATE INDEX idx_memory_embedding ON mission_memory
  USING hnsw (embedding vector_cosine_ops);

-- Tenant + type index for filtered searches
CREATE INDEX idx_memory_tenant_type ON mission_memory(tenant_id, mission_type);

-- ============================================================
-- Similarity search function
-- Returns top-K matching mission patterns for a given embedding.
-- Scoped by tenant_id (bypasses RLS via SECURITY DEFINER).
-- ============================================================
CREATE OR REPLACE FUNCTION match_mission_patterns(
  query_embedding VECTOR(1536),
  match_tenant_id UUID,
  match_threshold FLOAT DEFAULT 0.78,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  mission_id UUID,
  pattern_summary TEXT,
  mission_type TEXT,
  agent_count INTEGER,
  orchestration_pattern TEXT,
  success_score FLOAT,
  similarity FLOAT
) AS $$
  SELECT
    mm.id,
    mm.mission_id,
    mm.pattern_summary,
    mm.mission_type,
    mm.agent_count,
    mm.orchestration_pattern,
    mm.success_score,
    1 - (mm.embedding <=> query_embedding) AS similarity
  FROM mission_memory mm
  WHERE mm.tenant_id = match_tenant_id
    AND 1 - (mm.embedding <=> query_embedding) > match_threshold
  ORDER BY mm.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
