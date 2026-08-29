-- ============================================================
-- 006 — Agentic Memory + Dynamic Tool Schemas
-- ============================================================

-- Pre-built Anthropic tool definitions per mission per provider.
-- Fetched from Composio at mission creation / connector connect time,
-- refreshed every 24 h. Each row is one callable action (e.g.
-- GMAIL_SEND_EMAIL) with its full JSON-Schema parameters so the LLM
-- gets a precise, reliable tool list instead of guessing action slugs.
CREATE TABLE IF NOT EXISTS public.mission_tool_schemas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  mission_id     UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  provider_slug  TEXT NOT NULL,   -- Composio app slug, e.g. "gmail", "slack"
  action_name    TEXT NOT NULL,   -- Composio action slug, e.g. "GMAIL_SEND_EMAIL"
  display_name   TEXT NOT NULL,   -- Human label, e.g. "Send Email"
  description    TEXT NOT NULL,   -- Fed to the LLM as tool description
  parameters_schema JSONB NOT NULL DEFAULT '{"type":"object","properties":{}}',
  logo_url       TEXT,            -- https://logos.composio.dev/api/{slug}
  is_active      BOOLEAN NOT NULL DEFAULT true,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, mission_id, action_name)
);

CREATE INDEX IF NOT EXISTS idx_mission_tool_schemas_mission
  ON public.mission_tool_schemas (tenant_id, mission_id, is_active, fetched_at);

-- RLS
ALTER TABLE public.mission_tool_schemas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_own" ON public.mission_tool_schemas
  USING (tenant_id = auth.uid());


-- Episodic memory — one row per completed conversation, written by the AI
-- after the chat session ends. Injected as "Recent sessions" context on the
-- next conversation so the agent remembers what happened.
CREATE TABLE IF NOT EXISTS public.agent_episodes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  mission_id        UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  conversation_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  summary           TEXT NOT NULL,
  tools_used        TEXT[] DEFAULT '{}',
  outcomes          TEXT[] DEFAULT '{}',
  follow_ups        TEXT[] DEFAULT '{}',
  embedding         VECTOR(1536),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_episodes_mission
  ON public.agent_episodes (tenant_id, mission_id, created_at DESC);

ALTER TABLE public.agent_episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_own" ON public.agent_episodes
  USING (tenant_id = auth.uid());


-- Agent profiles — evolving customer profile per mission.
-- Facts learned from conversations are merged into profile_data JSONB
-- incrementally. Always injected into the system prompt.
CREATE TABLE IF NOT EXISTS public.agent_profiles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  mission_id   UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  profile_data JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, mission_id)
);

ALTER TABLE public.agent_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_own" ON public.agent_profiles
  USING (tenant_id = auth.uid());
