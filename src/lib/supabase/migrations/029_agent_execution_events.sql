-- ─────────────────────────────────────────────────────────────
-- 029_agent_execution_events
--
-- Stores discrete tool-status and completion events emitted by the
-- Inngest chat-agent function so the frontend can subscribe via
-- Supabase Realtime and show live progress without streaming text
-- tokens through Realtime (which caused the old race-condition).
--
-- One row per event. The frontend subscribes filtered by session_id
-- (an execution-scoped UUID generated per Inngest invocation).
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_execution_events (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id   text        NOT NULL,  -- execution-scoped UUID (one per Inngest run)
  tenant_id    text        NOT NULL,
  mission_id   text        NOT NULL,
  chat_id      text        NOT NULL,  -- mission_chats.id
  event_type   text        NOT NULL,  -- 'tool_status' | 'agent_completed' | 'agent_error'
  payload      jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_exec_session
  ON public.agent_execution_events (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_exec_tenant
  ON public.agent_execution_events (tenant_id, created_at);

-- RLS: tenants can only read their own execution events
ALTER TABLE public.agent_execution_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read_own_exec_events"
  ON public.agent_execution_events
  FOR SELECT
  USING (tenant_id = auth.uid()::text);

-- Realtime: enable so the frontend can subscribe to INSERT events
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_execution_events;
