-- ============================================================
-- Migration 021: Run History + Webhook Triggers
--
-- Three additions:
--   1. run_id column on events — lets the executor filter "agent.completed"
--      events to the current run only, fixing the recurring-mission bug where
--      run #2 would skip all agents because run #1's events were still present.
--   2. mission_runs — one row per execution of a mission. Source of truth for
--      the run history UI and the per-run summary email.
--   3. mission_webhooks — webhook URLs that trigger a mission on any external
--      POST (new Google Sheet row, form submission, CRM event, etc.).
-- ============================================================

-- ── 1. Add run_id to events ──────────────────────────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS run_id UUID;
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id) WHERE run_id IS NOT NULL;

-- ── 2. mission_runs ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  mission_id    UUID NOT NULL,
  run_number    INTEGER NOT NULL DEFAULT 1,
  trigger       TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger IN ('manual', 'scheduled', 'webhook')),
  status        TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'paused')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  duration_ms   INTEGER,
  agents_total  INTEGER NOT NULL DEFAULT 0,
  agents_done   INTEGER NOT NULL DEFAULT 0,
  agents_failed INTEGER NOT NULL DEFAULT 0,
  summary       JSONB
);

ALTER TABLE mission_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants see own mission runs" ON mission_runs
  FOR ALL USING (tenant_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_mission_runs_mission   ON mission_runs(mission_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mission_runs_tenant    ON mission_runs(tenant_id);

-- ── 3. mission_webhooks ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_webhooks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  mission_id         UUID NOT NULL,
  webhook_secret     TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  label              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_triggered_at  TIMESTAMPTZ,
  trigger_count      INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE mission_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants see own webhooks" ON mission_webhooks
  FOR ALL USING (tenant_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_mission_webhooks_mission ON mission_webhooks(mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_webhooks_tenant  ON mission_webhooks(tenant_id);
