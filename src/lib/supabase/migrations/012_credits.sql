-- ============================================================
-- Phase 15: Credit-Based Billing System
-- Adds credit tracking, active mission limits, and model tier
-- gating to the tenant_billing table.
-- ============================================================

-- Add credit-based columns
ALTER TABLE public.tenant_billing
    ADD COLUMN IF NOT EXISTS credits_remaining INTEGER DEFAULT 30,
    ADD COLUMN IF NOT EXISTS credits_total INTEGER DEFAULT 30,
    ADD COLUMN IF NOT EXISTS credits_used_this_month INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_active_missions INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS model_tier TEXT DEFAULT 'flash',
    ADD COLUMN IF NOT EXISTS governance TEXT DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS is_trial BOOLEAN DEFAULT TRUE;

-- Update existing free users to trial defaults
UPDATE public.tenant_billing
SET credits_remaining = 30,
    credits_total = 30,
    max_active_missions = 1,
    model_tier = 'flash',
    governance = 'none',
    is_trial = TRUE
WHERE plan = 'free' AND credits_remaining IS NULL;

-- Plan limit reference (credit-based):
-- ┌──────────────┬───────────────┬──────────────┬──────────────┬────────────┐
-- │              │ Free (Trial)  │ Individual   │ Pro (Teams)  │ Enterprise │
-- ├──────────────┼───────────────┼──────────────┼──────────────┼────────────┤
-- │ Price        │ ₹0            │ ₹2,499/mo    │ ₹1,249/seat  │ Custom     │
-- │ Credits      │ 50 (one-time) │ 1,000/mo     │ 5,000/mo     │ Unlimited  │
-- │ Intelligence │ Flash only    │ Mixed        │ All Models   │ All+Custom │
-- │ Active Miss. │ 1             │ 5            │ 50           │ Unlimited  │
-- │ Storage      │ 100MB         │ 10GB         │ 100GB        │ 1TB+       │
-- │ Governance   │ None          │ Basic Memory │ RBAC         │ Full Audit │
-- └──────────────┴───────────────┴──────────────┴──────────────┴────────────┘
