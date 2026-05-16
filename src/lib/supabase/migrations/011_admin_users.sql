-- ============================================================
-- Phase 18: Admin Users Table
-- Separate auth system for admin panel access.
-- Login requires email + password + OTP (via SMTP2GO).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    otp_code TEXT,
    otp_expires_at TIMESTAMPTZ
);

-- Seed the primary admin from env var (done via app code, not SQL)
-- The app will auto-create the primary admin on first /admin access.

-- RLS: admin_users is only accessible via service role
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- No public policies — only service role can read/write
-- This ensures admin data is never exposed to client-side code.
