-- Phase 15: Razorpay Billing Columns
-- Adds Razorpay-specific fields to tenant_billing.
-- Keeps existing Stripe columns for future dual-payment support.

ALTER TABLE public.tenant_billing
    ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT,
    ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS razorpay_plan_id TEXT;
