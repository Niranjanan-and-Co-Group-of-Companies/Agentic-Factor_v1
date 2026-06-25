-- ============================================================
-- Migration 017: Agent Template Library
-- Run this in Supabase SQL Editor after 016
--
-- Lets agents that survive Training Mode graduate into standalone,
-- reusable templates (role + prompt + code + tools), independent of
-- any one mission. Blueprint generation searches this library before
-- writing a new agent from scratch — turning memory from inspiration
-- text into actual reuse. Mirrors the existing tenant_mission_patterns
-- vector-memory infrastructure for consistency.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_mission_id UUID REFERENCES public.missions(id) ON DELETE SET NULL,
    role TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    python_script TEXT NOT NULL,
    tools JSONB DEFAULT '[]',
    capabilities TEXT[] DEFAULT '{}',
    trust_level TEXT DEFAULT 'conditional',
    success_count INTEGER NOT NULL DEFAULT 1,
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_used_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.agent_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own agent templates"
    ON public.agent_templates FOR ALL
    USING (auth.uid() = tenant_id);

-- Similarity search — used both at promotion time (high threshold, to find
-- "is this already basically the same agent") and at blueprint-generation
-- time (lower threshold, to find "what's roughly applicable here").
CREATE OR REPLACE FUNCTION match_agent_templates (
    query_embedding vector(1536),
    match_tenant_id uuid,
    match_threshold float,
    match_count int
)
RETURNS TABLE (
    id uuid,
    role text,
    system_prompt text,
    python_script text,
    tools jsonb,
    capabilities text[],
    trust_level text,
    success_count int,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        at.id,
        at.role,
        at.system_prompt,
        at.python_script,
        at.tools,
        at.capabilities,
        at.trust_level,
        at.success_count,
        1 - (at.embedding <=> query_embedding) AS similarity
    FROM agent_templates at
    WHERE at.tenant_id = match_tenant_id
      AND 1 - (at.embedding <=> query_embedding) > match_threshold
    ORDER BY at.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
