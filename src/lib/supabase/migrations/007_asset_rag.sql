-- Phase 6: Vector RAG Infrastructure
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Assets Table (The parent document/URL)
CREATE TABLE IF NOT EXISTS public.tenant_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mission_id UUID REFERENCES public.missions(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL CHECK (asset_type IN ('url', 'file', 'text')),
    classification TEXT NOT NULL DEFAULT 'resource' CHECK (classification IN ('resource', 'boundary')),
    source_uri TEXT NOT NULL,
    title TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Asset Chunks (The vectorized 512-token pieces)
CREATE TABLE IF NOT EXISTS public.asset_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES public.tenant_assets(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mission_id UUID REFERENCES public.missions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    classification TEXT NOT NULL DEFAULT 'resource',
    embedding vector(1536) NOT NULL, -- Assuming OpenAI text-embedding-3-small or Gemini text-embedding-004
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS Policies
ALTER TABLE public.tenant_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own assets"
    ON public.tenant_assets FOR ALL
    USING (auth.uid() = tenant_id);

CREATE POLICY "Users can manage their own asset chunks"
    ON public.asset_chunks FOR ALL
    USING (auth.uid() = tenant_id);

-- Create a function for similarity search (RAG)
CREATE OR REPLACE FUNCTION match_asset_chunks (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_tenant_id uuid,
  p_mission_id uuid
)
RETURNS TABLE (
  id uuid,
  asset_id uuid,
  content text,
  classification text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ac.id,
    ac.asset_id,
    ac.content,
    ac.classification,
    1 - (ac.embedding <=> query_embedding) AS similarity
  FROM asset_chunks ac
  WHERE ac.tenant_id = p_tenant_id
    AND (ac.mission_id = p_mission_id OR ac.mission_id IS NULL) -- Allow global tenant assets or mission-specific assets
    AND 1 - (ac.embedding <=> query_embedding) > match_threshold
  ORDER BY ac.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
