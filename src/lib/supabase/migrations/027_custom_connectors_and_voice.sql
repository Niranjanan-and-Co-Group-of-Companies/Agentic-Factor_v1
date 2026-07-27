-- ============================================================
-- Migration 027: Custom Connectors + Voice Calls
--
-- 1. tenant_permissions.metadata — stores extra info for custom
--    connectors: display_name, base_url, auth_type, auth_header
--
-- 2. voice_calls — tracks every inbound/outbound AI voice call:
--    status, duration, transcript, outcome, Vapi call ID
-- ============================================================

-- ── 1. Add metadata column to tenant_permissions ─────────────
ALTER TABLE public.tenant_permissions
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

COMMENT ON COLUMN public.tenant_permissions.metadata IS
  'Optional JSON metadata for custom connectors: { display_name, base_url, auth_type, auth_header }';

-- ── 2. Voice calls table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mission_id      UUID REFERENCES public.missions(id) ON DELETE SET NULL,
  mission_run_id  UUID REFERENCES public.mission_runs(id) ON DELETE SET NULL,

  -- Call identity
  external_id     TEXT,                     -- Vapi/Twilio call ID
  provider        TEXT NOT NULL DEFAULT 'vapi',

  -- Direction + caller info
  direction       TEXT NOT NULL DEFAULT 'inbound',  -- inbound | outbound
  phone_from      TEXT,
  phone_to        TEXT,

  -- Status lifecycle
  status          TEXT NOT NULL DEFAULT 'initiated', -- initiated | ringing | in_progress | completed | failed | no_answer
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at     TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  duration_seconds INTEGER,

  -- Content
  transcript      TEXT,
  summary         TEXT,
  outcome         TEXT,                     -- booked | cancelled | transferred | info_given | voicemail | other
  sentiment       TEXT,                     -- positive | neutral | negative

  -- Metadata
  metadata        JSONB DEFAULT NULL,       -- raw provider webhook payload, custom fields
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.voice_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant owns voice_calls" ON public.voice_calls;
CREATE POLICY "Tenant owns voice_calls" ON public.voice_calls
  FOR ALL USING (tenant_id = auth.uid());

DROP POLICY IF EXISTS "Team members can read voice_calls" ON public.voice_calls;
CREATE POLICY "Team members can read voice_calls" ON public.voice_calls
  FOR SELECT USING (team_has_access(tenant_id));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_voice_calls_tenant ON public.voice_calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_voice_calls_mission ON public.voice_calls(mission_id);
CREATE INDEX IF NOT EXISTS idx_voice_calls_status ON public.voice_calls(status);
CREATE INDEX IF NOT EXISTS idx_voice_calls_started ON public.voice_calls(started_at DESC);
