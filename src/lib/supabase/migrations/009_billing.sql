-- Phase 14: Billing & Tenant Tier Management
-- Supports: Free, Individual, Pro (Per Seat), Enterprise

CREATE TABLE IF NOT EXISTS public.tenant_billing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Plan type
    plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'individual', 'pro', 'enterprise')),
    
    -- Stripe references
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_price_id TEXT,
    
    -- Seat management (for Pro plan)
    seat_count INTEGER NOT NULL DEFAULT 1,
    max_seats INTEGER NOT NULL DEFAULT 1,
    
    -- Usage limits (overridable per tenant)
    max_missions_per_month INTEGER NOT NULL DEFAULT 3,       -- Free: 3, Individual: 20, Pro: 100, Enterprise: unlimited
    max_tokens_per_day INTEGER NOT NULL DEFAULT 50000,       -- Free: 50K, Individual: 200K, Pro: 500K, Enterprise: 5M
    max_agents_per_mission INTEGER NOT NULL DEFAULT 2,       -- Free: 2, Individual: 5, Pro: 15, Enterprise: unlimited
    max_storage_mb INTEGER NOT NULL DEFAULT 100,             -- Free: 100MB, Individual: 1GB, Pro: 10GB, Enterprise: 100GB
    
    -- Current billing period usage
    missions_this_month INTEGER NOT NULL DEFAULT 0,
    tokens_today INTEGER NOT NULL DEFAULT 0,
    tokens_this_month INTEGER NOT NULL DEFAULT 0,
    storage_used_mb FLOAT NOT NULL DEFAULT 0,
    
    -- Period tracking
    billing_period_start TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    billing_period_end TIMESTAMP WITH TIME ZONE,
    
    -- Status
    billing_status TEXT NOT NULL DEFAULT 'active' CHECK (billing_status IN ('active', 'past_due', 'cancelled', 'trialing')),
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(tenant_id)
);

-- RLS
ALTER TABLE public.tenant_billing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own billing"
    ON public.tenant_billing FOR SELECT
    USING (auth.uid() = tenant_id);

-- Service role can manage all billing (for webhooks and cron)
CREATE POLICY "Service role manages billing"
    ON public.tenant_billing FOR ALL
    USING (auth.role() = 'service_role');

-- Function: Initialize billing for new users (called after signup)
CREATE OR REPLACE FUNCTION initialize_tenant_billing()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.tenant_billing (tenant_id, plan)
    VALUES (NEW.id, 'free')
    ON CONFLICT (tenant_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Auto-create billing row when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created_billing ON auth.users;
CREATE TRIGGER on_auth_user_created_billing
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION initialize_tenant_billing();

-- Function: Reset daily token count (called by cron)
CREATE OR REPLACE FUNCTION reset_daily_tokens()
RETURNS void AS $$
BEGIN
    UPDATE public.tenant_billing SET tokens_today = 0;
END;
$$ LANGUAGE plpgsql;

-- Function: Reset monthly mission count (called by cron on 1st of month)
CREATE OR REPLACE FUNCTION reset_monthly_usage()
RETURNS void AS $$
BEGIN
    UPDATE public.tenant_billing 
    SET missions_this_month = 0, 
        tokens_this_month = 0,
        billing_period_start = timezone('utc'::text, now());
END;
$$ LANGUAGE plpgsql;

-- Plan limit reference (for documentation, enforced in app code):
-- ┌──────────────┬────────┬────────────┬───────┬────────────┐
-- │              │ Free   │ Individual │ Pro   │ Enterprise │
-- ├──────────────┼────────┼────────────┼───────┼────────────┤
-- │ Missions/mo  │ 3      │ 20         │ 100   │ Unlimited  │
-- │ Tokens/day   │ 50K    │ 200K       │ 500K  │ 5M         │
-- │ Agents/miss  │ 2      │ 5          │ 15    │ Unlimited  │
-- │ Storage      │ 100MB  │ 1GB        │ 10GB  │ 100GB      │
-- │ Seats        │ 1      │ 1          │ 1-50  │ Unlimited  │
-- │ Connectors   │ 2      │ 10         │ 40+   │ All        │
-- │ Price        │ $0     │ $29/mo     │ $15/seat│ Custom    │
-- └──────────────┴────────┴────────────┴───────┴────────────┘
