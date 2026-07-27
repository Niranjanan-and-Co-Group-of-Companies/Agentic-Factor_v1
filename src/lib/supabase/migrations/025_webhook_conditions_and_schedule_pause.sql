-- ============================================================
-- Migration 025: Webhook filter conditions + Mission schedule pause
--
-- 1. mission_webhooks.filter_conditions — optional JSONB payload
--    filter so a webhook only fires when conditions match.
--    Format: [{ "field": "event_type", "operator": "eq", "value": "payment.succeeded" }]
--
-- 2. missions.schedule_paused — lets users pause a recurring
--    schedule without deleting it. Cron scheduler skips missions
--    where schedule_paused = true.
-- ============================================================

ALTER TABLE public.mission_webhooks
    ADD COLUMN IF NOT EXISTS filter_conditions JSONB DEFAULT NULL;

COMMENT ON COLUMN public.mission_webhooks.filter_conditions IS
  'Optional array of {field, operator, value} conditions. NULL = fire on every request.';

ALTER TABLE public.missions
    ADD COLUMN IF NOT EXISTS schedule_paused BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.missions.schedule_paused IS
  'When true, cron scheduler skips this mission even if a schedule is set.';

-- Index to help the scheduler skip paused missions quickly
CREATE INDEX IF NOT EXISTS idx_missions_schedule_paused
    ON public.missions(schedule_paused)
    WHERE schedule_paused = FALSE;
