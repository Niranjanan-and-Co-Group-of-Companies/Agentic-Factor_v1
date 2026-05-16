-- Phase 7.7: Mission Pattern Memory
-- Creates the table and function for vector memory search of similar past missions.
-- This enables the intake engine to learn from past successful missions.

-- Table: stores patterns extracted from completed missions
CREATE TABLE IF NOT EXISTS public.tenant_mission_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mission_id UUID REFERENCES public.missions(id) ON DELETE SET NULL,
    pattern_summary TEXT NOT NULL,
    orchestration_pattern TEXT NOT NULL,
    agent_count INTEGER NOT NULL DEFAULT 0,
    agent_roles TEXT[] DEFAULT '{}',
    success_score FLOAT NOT NULL DEFAULT 0.5,
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS Policy
ALTER TABLE public.tenant_mission_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own mission patterns"
    ON public.tenant_mission_patterns FOR ALL
    USING (auth.uid() = tenant_id);

-- Function: similarity search for past mission patterns
CREATE OR REPLACE FUNCTION match_mission_patterns (
    query_embedding vector(1536),
    match_tenant_id uuid,
    match_threshold float,
    match_count int
)
RETURNS TABLE (
    id uuid,
    mission_id uuid,
    pattern_summary text,
    orchestration_pattern text,
    agent_count int,
    agent_roles text[],
    success_score float,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        tmp.id,
        tmp.mission_id,
        tmp.pattern_summary,
        tmp.orchestration_pattern,
        tmp.agent_count,
        tmp.agent_roles,
        tmp.success_score,
        1 - (tmp.embedding <=> query_embedding) AS similarity
    FROM tenant_mission_patterns tmp
    WHERE tmp.tenant_id = match_tenant_id
      AND 1 - (tmp.embedding <=> query_embedding) > match_threshold
    ORDER BY tmp.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
