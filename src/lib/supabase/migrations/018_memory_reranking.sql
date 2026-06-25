-- ============================================================
-- Migration 018: Memory Re-ranking
-- Run this in Supabase SQL Editor after 017
--
-- Both vector-memory lookups (mission patterns, agent templates) used to
-- rank purely on cosine similarity. This adds a re-ranking pass: among
-- results that already clear the relevance threshold, proven patterns/
-- templates (higher success_score / success_count) are preferred over
-- merely-similar ones. Similarity stays the gate (the threshold filter is
-- unchanged) — proven-ness only affects ordering among already-relevant
-- candidates, never lets an irrelevant one through.
--
-- NOTE: mission_memory (migration 003) is confirmed unused anywhere in the
-- codebase — tenant_mission_patterns (migration 008) is the table actually
-- queried. Left untouched here rather than dropped, since deleting a table
-- is irreversible and should be a deliberate, explicit decision rather than
-- something bundled into a re-ranking migration.
-- ============================================================

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
    -- Re-rank: similarity dominates (0.75), success_score breaks ties among
    -- already-relevant matches (0.25) — a barely-relevant high-score pattern
    -- can never outrank a clearly-relevant one, since the threshold above
    -- already filtered on raw similarity, not this blended score.
    ORDER BY (1 - (tmp.embedding <=> query_embedding)) * 0.75 + tmp.success_score * 0.25 DESC
    LIMIT match_count;
END;
$$;

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
    -- Same re-ranking idea: similarity dominates (0.75), proven-use count
    -- breaks ties (0.25), capped at 10 uses so one very-reused template
    -- can't permanently dominate every search regardless of relevance.
    ORDER BY (1 - (at.embedding <=> query_embedding)) * 0.75
           + LEAST(at.success_count::float / 10.0, 1.0) * 0.25 DESC
    LIMIT match_count;
END;
$$;
