-- ============================================================
-- Migration 030: mission_runs — add 'queued' status + current_agent
--
-- Two changes:
--   1. Extend the status CHECK to include 'queued' so routes can
--      pre-create a mission_runs row before Inngest starts — this
--      lets the chat subscribe to Realtime before the run begins.
--   2. Add current_agent TEXT so the executor can broadcast which
--      agent is currently running, enabling per-agent live status.
-- ============================================================

-- Drop and recreate the CHECK constraint to include 'queued'
ALTER TABLE mission_runs DROP CONSTRAINT IF EXISTS mission_runs_status_check;
ALTER TABLE mission_runs
  ADD CONSTRAINT mission_runs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'paused'));

-- Add current_agent column (nullable — null means no agent running yet)
ALTER TABLE mission_runs
  ADD COLUMN IF NOT EXISTS current_agent TEXT;
