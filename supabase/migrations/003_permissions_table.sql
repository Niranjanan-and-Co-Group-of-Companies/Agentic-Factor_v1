-- Create tenant_permissions table
CREATE TABLE IF NOT EXISTS public.tenant_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, -- references tenants if you have one, or just the user auth.uid() or similar tenant concept
    provider TEXT NOT NULL, -- e.g. 'google', 'slack'
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    scopes TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, provider)
);

-- Enable RLS
ALTER TABLE public.tenant_permissions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own tenant permissions"
    ON public.tenant_permissions
    FOR SELECT
    USING (
        tenant_id = auth.uid()
    );

CREATE POLICY "Users can insert their own tenant permissions"
    ON public.tenant_permissions
    FOR INSERT
    WITH CHECK (
        tenant_id = auth.uid()
    );

CREATE POLICY "Users can update their own tenant permissions"
    ON public.tenant_permissions
    FOR UPDATE
    USING (
        tenant_id = auth.uid()
    );
