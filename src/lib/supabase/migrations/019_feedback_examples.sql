-- ============================================================
-- Migration 019: Feedback Examples
-- Run this in Supabase SQL Editor after 018
--
-- Captures real corrections — both human-confirmed (Chief of Staff
-- blueprint mutations triggered by a customer's correction note) and
-- AI-self-detected (the Phase 5 critic pass catching a wrong-but-plausible
-- output) — as a structured dataset. Blueprint generation searches this
-- before writing new agents, so past mistakes for similar requests are
-- surfaced as "avoid repeating this," not just relied on to not recur by
-- chance. Mirrors the existing pattern/template vector-memory infrastructure.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tenant_feedback_examples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_mission_id UUID REFERENCES public.missions(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'critic' CHECK (source IN ('critic', 'human_correction')),
    agent_role TEXT,
    problem_summary TEXT NOT NULL,
    correction_note TEXT,
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.tenant_feedback_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own feedback examples"
    ON public.tenant_feedback_examples FOR ALL
    USING (auth.uid() = tenant_id);

CREATE OR REPLACE FUNCTION match_feedback_examples (
    query_embedding vector(1536),
    match_tenant_id uuid,
    match_threshold float,
    match_count int
)
RETURNS TABLE (
    id uuid,
    source text,
    agent_role text,
    problem_summary text,
    correction_note text,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        tfe.id,
        tfe.source,
        tfe.agent_role,
        tfe.problem_summary,
        tfe.correction_note,
        1 - (tfe.embedding <=> query_embedding) AS similarity
    FROM tenant_feedback_examples tfe
    WHERE tfe.tenant_id = match_tenant_id
      AND 1 - (tfe.embedding <=> query_embedding) > match_threshold
    ORDER BY tfe.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
