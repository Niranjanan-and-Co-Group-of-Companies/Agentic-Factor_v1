import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// Billing Enforcement — Credit-Based Plan System
// Every agent action costs credits. Plans determine:
// 1. Credit pool size (replenished monthly)
// 2. Max active (concurrent) missions
// 3. Model access tier (flash / mixed / all / custom)
// 4. Governance level
// ============================================================

export type ModelTier = 'flash' | 'mixed' | 'all' | 'custom';

export interface PlanConfig {
  credits: number;            // Per-seat for Pro (1000 × seat_count in DB)
  maxActiveMissions: number;
  modelTier: ModelTier;
  maxStorageMb: number;
  governance: string;
  isTrial: boolean;
  maxClarifications: number;
  maxFanOutRoles: number;     // Max parallel fan-out tracks (multi-role missions)
  schedulingEnabled: boolean; // Whether cron scheduling is available
}

const PLAN_DEFAULTS: Record<string, PlanConfig> = {
  free:       { credits: 30,    maxActiveMissions: 1,     modelTier: 'flash',  maxStorageMb: 100,       governance: 'none',          isTrial: true,  maxClarifications: 2, maxFanOutRoles: 0,      schedulingEnabled: false },
  individual: { credits: 1000,  maxActiveMissions: 5,     modelTier: 'mixed',  maxStorageMb: 10_240,    governance: 'basic_memory',  isTrial: false, maxClarifications: 4, maxFanOutRoles: 2,      schedulingEnabled: true },
  pro:        { credits: 1000,  maxActiveMissions: 50,    modelTier: 'all',    maxStorageMb: 102_400,   governance: 'rbac',          isTrial: false, maxClarifications: 6, maxFanOutRoles: 99999,  schedulingEnabled: true },
  enterprise: { credits: 99999, maxActiveMissions: 99999, modelTier: 'custom', maxStorageMb: 1_048_576, governance: 'full_audit',    isTrial: false, maxClarifications: 10, maxFanOutRoles: 99999, schedulingEnabled: true },
};

// Credit costs per action type
export const CREDIT_COSTS = {
  llm_call_flash: 1,     // Claude Haiku, Gemini Flash, GPT-4o-mini
  llm_call_pro: 3,       // Claude 3.5 Sonnet, Gemini Pro, GPT-4o
  llm_call_premium: 5,   // Claude Sonnet 4
  code_execution: 2,     // E2B sandbox run
  embedding: 0.5,        // Embedding generation
  ingest_chunk: 0.1,     // RAG document chunk
  schedule_daily: 1,     // Per scheduled mission per day (cron maintenance)
} as const;

/**
 * Get the correct LLM credit cost based on the tenant's model tier.
 * This fixes the bug where executor.ts always charged flash rate.
 */
export function getLLMCostForTier(modelTier: ModelTier): number {
  switch (modelTier) {
    case 'all':
    case 'custom':  return CREDIT_COSTS.llm_call_premium;
    case 'mixed':   return CREDIT_COSTS.llm_call_pro;
    case 'flash':
    default:        return CREDIT_COSTS.llm_call_flash;
  }
}

export interface BillingCheck {
  allowed: boolean;
  plan: string;
  reason?: string;
  creditsRemaining?: number;
  creditsTotal?: number;
  modelTier?: ModelTier;
}

/**
 * Check if a tenant has enough credits for an action.
 */
export async function checkCredits(tenantId: string, cost: number = 1): Promise<BillingCheck> {
  const supabase = createServiceClient();

  const { data: billing } = await supabase
    .from('tenant_billing')
    .select('plan, credits_remaining, credits_total, billing_status, model_tier, is_trial')
    .eq('tenant_id', tenantId)
    .single();

  const plan = billing?.plan || 'free';
  const creditsRemaining = billing?.credits_remaining ?? PLAN_DEFAULTS[plan]?.credits ?? 50;

  if (billing?.billing_status === 'past_due') {
    return { allowed: false, plan, reason: 'Account has past-due billing. Please update your payment method.' };
  }
  if (billing?.billing_status === 'cancelled') {
    return { allowed: false, plan, reason: 'Subscription cancelled. Please resubscribe to continue.' };
  }

  if (creditsRemaining < cost) {
    const msg = billing?.is_trial
      ? 'Trial credits exhausted. Upgrade to Individual or Pro for monthly credits.'
      : `Not enough credits (${creditsRemaining} remaining, ${cost} needed). Upgrade your plan or wait for monthly reset.`;
    return {
      allowed: false,
      plan,
      reason: msg,
      creditsRemaining,
      creditsTotal: billing?.credits_total ?? 50,
    };
  }

  return {
    allowed: true,
    plan,
    creditsRemaining,
    creditsTotal: billing?.credits_total ?? 50,
    modelTier: (billing?.model_tier as ModelTier) || 'flash',
  };
}

/**
 * Check if a tenant can create/start another active mission.
 */
export async function checkActiveMissions(tenantId: string): Promise<BillingCheck> {
  const supabase = createServiceClient();

  const { data: billing } = await supabase
    .from('tenant_billing')
    .select('plan, max_active_missions, credits_remaining, credits_total')
    .eq('tenant_id', tenantId)
    .single();

  const plan = billing?.plan || 'free';
  const maxActive = billing?.max_active_missions ?? PLAN_DEFAULTS[plan]?.maxActiveMissions ?? 1;

  // Count currently active missions
  const { count } = await supabase
    .from('missions')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('status', ['active', 'building', 'needs_approval']);

  const activeMissions = count || 0;

  if (activeMissions >= maxActive) {
    return {
      allowed: false,
      plan,
      reason: `Active mission limit reached (${activeMissions}/${maxActive}). Complete or cancel a mission before starting a new one. Upgrade for more.`,
      creditsRemaining: billing?.credits_remaining ?? 0,
      creditsTotal: billing?.credits_total ?? 50,
    };
  }

  return { allowed: true, plan, creditsRemaining: billing?.credits_remaining ?? 0, creditsTotal: billing?.credits_total ?? 50 };
}

/**
 * Check if a tenant has access to a specific model tier.
 */
export async function checkModelAccess(tenantId: string, requestedTier: ModelTier): Promise<BillingCheck> {
  const supabase = createServiceClient();

  const { data: billing } = await supabase
    .from('tenant_billing')
    .select('plan, model_tier')
    .eq('tenant_id', tenantId)
    .single();

  const plan = billing?.plan || 'free';
  const userTier = (billing?.model_tier as ModelTier) || 'flash';

  const tierHierarchy: Record<ModelTier, number> = { flash: 0, mixed: 1, all: 2, custom: 3 };

  if (tierHierarchy[requestedTier] > tierHierarchy[userTier]) {
    return {
      allowed: false,
      plan,
      reason: `Your ${plan} plan only has access to ${userTier} models. Upgrade to use ${requestedTier} models.`,
      modelTier: userTier,
    };
  }

  return { allowed: true, plan, modelTier: userTier };
}

/**
 * Deduct credits from a tenant's balance.
 * Call this after a successful action (LLM call, code execution, etc.)
 */
export async function deductCredits(tenantId: string, amount: number, actionType: string): Promise<void> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('tenant_billing')
    .select('credits_remaining, credits_used_this_month')
    .eq('tenant_id', tenantId)
    .single();

  if (data) {
    const newRemaining = Math.max(0, (data.credits_remaining || 0) - amount);
    const newUsed = (data.credits_used_this_month || 0) + amount;

    await supabase
      .from('tenant_billing')
      .update({
        credits_remaining: newRemaining,
        credits_used_this_month: newUsed,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);

    // Log credit usage event (fire-and-forget)
    try {
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'billing.credit_used',
        entity_type: 'billing',
        entity_id: tenantId,
        payload: { amount, actionType, remainingAfter: newRemaining },
      });
    } catch { /* non-critical */ }
  }
}

/**
 * Get the credit cost for an LLM model.
 */
export function getModelCreditCost(model: string): number {
  const flashModels = ['gemini-2.0-flash', 'gemini-flash', 'gpt-4o-mini'];
  const proModels = ['gemini-2.5-pro', 'gemini-pro', 'gpt-4o'];
  const premiumModels = ['claude-opus', 'o1', 'o1-pro'];

  if (flashModels.some(m => model.includes(m))) return CREDIT_COSTS.llm_call_flash;
  if (proModels.some(m => model.includes(m))) return CREDIT_COSTS.llm_call_pro;
  if (premiumModels.some(m => model.includes(m))) return CREDIT_COSTS.llm_call_premium;
  return CREDIT_COSTS.llm_call_flash; // Default to flash cost
}

/**
 * Get the full plan config for a tenant.
 * Used by intake engine to determine clarification depth, model tier, etc.
 */
export async function getPlanConfig(tenantId: string): Promise<PlanConfig> {
  const supabase = createServiceClient();

  const { data: billing } = await supabase
    .from('tenant_billing')
    .select('plan')
    .eq('tenant_id', tenantId)
    .single();

  const plan = billing?.plan || 'free';
  return PLAN_DEFAULTS[plan] || PLAN_DEFAULTS['free'];
}
