-- ============================================================
-- Migration 013: Trust Level + Mission Email Columns
-- Run this in Supabase SQL Editor after 012
-- ============================================================

-- 1. Add trust_level column to agents table
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS trust_level TEXT DEFAULT 'conditional'
  CHECK (trust_level IN ('manual', 'conditional', 'autonomous'));

-- 2. Add sender whitelist columns for mission email inbox (Phase 28)
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS inbound_email TEXT;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS allowed_senders TEXT[] DEFAULT '{}';

-- 3. Update RLS: allow users to update their own agents' trust_level
CREATE POLICY "Users can update their own agents"
    ON public.agents FOR UPDATE
    USING (tenant_id = auth.uid())
    WITH CHECK (tenant_id = auth.uid());
