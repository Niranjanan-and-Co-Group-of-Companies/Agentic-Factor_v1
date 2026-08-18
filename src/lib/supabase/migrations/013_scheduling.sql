-- ============================================================
-- Migration: Add scheduling support
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add 'scheduled' and 'awaiting_input' to mission status CHECK constraint
-- First drop the existing constraint, then re-add with new values
ALTER TABLE missions DROP CONSTRAINT IF EXISTS missions_status_check;
ALTER TABLE missions ADD CONSTRAINT missions_status_check
  CHECK (status IN (
    'draft', 'pending_permissions', 'pending_validation',
    'pending_approval', 'building', 'active', 'paused',
    'completed', 'failed', 'deadlocked', 'awaiting_input'
  ));

-- 2. Add index for cron scheduler to quickly find wait events
CREATE INDEX IF NOT EXISTS idx_events_wait 
  ON events(event_type, created_at) 
  WHERE event_type = 'mission.wait';

-- 3. Add credits_topup column (if not already done)
ALTER TABLE tenant_billing 
  ADD COLUMN IF NOT EXISTS credits_topup INTEGER DEFAULT 0;
