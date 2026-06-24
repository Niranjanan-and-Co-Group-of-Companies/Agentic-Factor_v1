-- ============================================================
-- Migration 014: Approval Context Columns
-- Run this in Supabase SQL Editor after 013
--
-- The /approvals page has always queried agent_role, mission_title,
-- and explanation directly off proposed_actions, but those columns
-- were never created — this adds them so the review queue actually
-- shows which agent/mission an action belongs to and why it's there.
-- ============================================================

ALTER TABLE public.proposed_actions ADD COLUMN IF NOT EXISTS agent_role TEXT;
ALTER TABLE public.proposed_actions ADD COLUMN IF NOT EXISTS mission_title TEXT;
ALTER TABLE public.proposed_actions ADD COLUMN IF NOT EXISTS explanation TEXT;
