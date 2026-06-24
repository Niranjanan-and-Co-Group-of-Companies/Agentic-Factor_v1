-- ============================================================
-- Migration 016: Training Mode
-- Run this in Supabase SQL Editor after 015
--
-- Lets a customer run a mission 1-5 times in a safe rehearsal mode
-- before it goes live. In training mode every write action always
-- pauses for review and is never actually executed (no real email
-- sent, no real calendar event created) — only the dry-run preview
-- is shown. The mission auto-graduates to live after the configured
-- number of runs, or the customer can graduate early.
-- ============================================================

ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS training_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS training_runs_completed INTEGER DEFAULT 0;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS training_runs_max INTEGER DEFAULT 5;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS training_graduated_at TIMESTAMPTZ;
