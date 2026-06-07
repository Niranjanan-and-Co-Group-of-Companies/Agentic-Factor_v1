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

// Credit costs per action type (4X markup on raw LLM costs)
// These are what CUSTOMERS pay. Internal tracking uses calculateRealCostUsd.
export const CREDIT_COSTS = {
  llm_call_flash: 4,      // Claude Haiku, Gemini Flash, GPT-4o-mini (was 1)
  llm_call_pro: 12,       // Claude Sonnet, Gemini 2.5 Flash, GPT-4o (was 3)
  llm_call_premium: 20,   // Claude Opus, Gemini Pro (was 5)
  code_execution: 8,      // E2B sandbox run (was 2)
  embedding: 2,           // Embedding generation (was 0.5)
  ingest_chunk: 0.4,      // RAG document chunk (was 0.1)
  schedule_daily: 4,      // Per scheduled mission per day (was 1)
} as const;

// ── Token-Based Billing: Real Cost per 1K tokens (USD) ──
// These are our ACTUAL costs from each provider. Used for internal tracking.
// Customer credits are our markup on top of these real costs.
const TOKEN_COSTS_PER_1K: Record<string, { input: number; output: number }> = {
  // Anthropic (https://docs.anthropic.com/en/docs/about-claude/pricing)
  'claude-opus':    { input: 0.015,  output: 0.075 },
  'claude-sonnet':  { input: 0.003,  output: 0.015 },
  'claude-haiku':   { input: 0.001,  output: 0.005 },
  // Gemini
  'gemini-2.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-2.0-flash': { input: 0.000075, output: 0.0003 },
  // OpenAI
  'gpt-4o':         { input: 0.0025, output: 0.01 },
  'gpt-4o-mini':    { input: 0.00015, output: 0.0006 },
};

/**
 * Calculate the real USD cost for an LLM call based on actual tokens used.
 * Used for internal profit tracking — NOT shown to customers.
 */
export function calculateRealCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  // Find matching cost entry
  const matchKey = Object.keys(TOKEN_COSTS_PER_1K).find(k => model.includes(k));
  if (!matchKey) return 0;
  const costs = TOKEN_COSTS_PER_1K[matchKey];
  return (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;
}

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
 * Ensure a tenant has a billing record. If not, create one with free trial credits.
 * Called automatically before any credit check or deduction.
 */
export async function ensureBillingRecord(tenantId: string): Promise<void> {
  const supabase = createServiceClient();
  
  const { data: existing } = await supabase
    .from('tenant_billing')
    .select('tenant_id')
    .eq('tenant_id', tenantId)
    .single();
  
  if (!existing) {
    const freeConfig = PLAN_DEFAULTS['free'];
    await supabase.from('tenant_billing').insert({
      tenant_id: tenantId,
      plan: 'free',
      credits_remaining: freeConfig.credits,
      credits_total: freeConfig.credits,
      credits_used_this_month: 0,
      max_active_missions: freeConfig.maxActiveMissions,
      model_tier: freeConfig.modelTier,
      max_storage_mb: freeConfig.maxStorageMb,
      governance: freeConfig.governance,
      is_trial: true,
      billing_status: 'active',
      billing_period_start: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    console.log(`[Billing] Created free trial billing record for tenant ${tenantId} (${freeConfig.credits} credits)`);
  }
}

/**
 * Check if a tenant has enough credits for an action.
 */
export async function checkCredits(tenantId: string, cost: number = 1): Promise<BillingCheck> {
  const supabase = createServiceClient();

  // Auto-provision billing record if missing
  await ensureBillingRecord(tenantId);

  const { data: billing } = await supabase
    .from('tenant_billing')
    .select('plan, credits_remaining, credits_topup, credits_total, billing_status, model_tier, is_trial')
    .eq('tenant_id', tenantId)
    .single();

  const plan = billing?.plan || 'free';
  const creditsMonthly = billing?.credits_remaining ?? PLAN_DEFAULTS[plan]?.credits ?? 30;
  const creditsTopup = billing?.credits_topup ?? 0;
  const totalAvailable = creditsMonthly + creditsTopup;

  if (billing?.billing_status === 'past_due') {
    return { allowed: false, plan, reason: 'Account has past-due billing. Please update your payment method.' };
  }
  if (billing?.billing_status === 'cancelled') {
    const frozenMsg = creditsTopup > 0
      ? ` You have ${creditsTopup} frozen top-up credits that will be restored when you resubscribe.`
      : '';
    return { allowed: false, plan, reason: `Subscription cancelled. Please resubscribe to continue.${frozenMsg}` };
  }

  if (totalAvailable < cost) {
    const msg = billing?.is_trial
      ? 'Trial credits exhausted. Upgrade to Individual or Pro for monthly credits.'
      : `Not enough credits (${totalAvailable} remaining, ${cost} needed). Buy a top-up pack or wait for monthly reset.`;
    return {
      allowed: false,
      plan,
      reason: msg,
      creditsRemaining: totalAvailable,
      creditsTotal: billing?.credits_total ?? 30,
    };
  }

  return {
    allowed: true,
    plan,
    creditsRemaining: totalAvailable,
    creditsTotal: billing?.credits_total ?? 30,
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
      creditsTotal: billing?.credits_total ?? 30,
    };
  }

  return { allowed: true, plan, creditsRemaining: billing?.credits_remaining ?? 0, creditsTotal: billing?.credits_total ?? 30 };
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
 * Optionally tracks real token costs for internal profit analysis.
 */
export async function deductCredits(
  tenantId: string,
  amount: number,
  actionType: string,
  tokenMeta?: { provider: string; model: string; inputTokens?: number; outputTokens?: number }
): Promise<void> {
  const supabase = createServiceClient();

  // Auto-provision billing record if missing
  await ensureBillingRecord(tenantId);

  const { data } = await supabase
    .from('tenant_billing')
    .select('credits_remaining, credits_topup, credits_used_this_month')
    .eq('tenant_id', tenantId)
    .single();

  if (data) {
    const creditsMonthly = data.credits_remaining || 0;
    const creditsTopup = data.credits_topup || 0;
    const totalAvailable = creditsMonthly + creditsTopup;
    
    // Hard stop: refuse to deduct if credits are insufficient
    if (totalAvailable < amount) {
      throw new Error(`Insufficient credits: ${totalAvailable} remaining (${creditsMonthly} monthly + ${creditsTopup} top-up), ${amount} needed for ${actionType}`);
    }

    // Two-bucket deduction: consume monthly credits FIRST, then top-up
    let deductFromMonthly = Math.min(creditsMonthly, amount);
    let deductFromTopup = amount - deductFromMonthly;

    const newMonthly = creditsMonthly - deductFromMonthly;
    const newTopup = creditsTopup - deductFromTopup;
    const newUsed = (data.credits_used_this_month || 0) + amount;

    await supabase
      .from('tenant_billing')
      .update({
        credits_remaining: newMonthly,
        credits_topup: newTopup,
        credits_used_this_month: newUsed,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);

    // Calculate real USD cost if token metadata is provided
    let realCostUsd: number | undefined;
    if (tokenMeta?.inputTokens || tokenMeta?.outputTokens) {
      realCostUsd = calculateRealCostUsd(
        tokenMeta.model,
        tokenMeta.inputTokens || 0,
        tokenMeta.outputTokens || 0
      );
    }

    // Log credit usage event with real cost tracking (fire-and-forget)
    try {
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'billing.credit_used',
        entity_type: 'billing',
        entity_id: tenantId,
        payload: {
          amount,
          actionType,
          remainingAfter: newRemaining,
          // Internal cost tracking (not exposed to customer)
          ...(tokenMeta ? {
            provider: tokenMeta.provider,
            model: tokenMeta.model,
            inputTokens: tokenMeta.inputTokens,
            outputTokens: tokenMeta.outputTokens,
            realCostUsd,
          } : {}),
        },
      });
    } catch { /* non-critical */ }
  } else {
    // No billing record found — block the action
    throw new Error('No billing record found. Cannot deduct credits.');
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
