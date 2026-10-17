import { createServiceClient } from '@/lib/supabase/server';
import { getUsdToInr } from '@/lib/services/fx-rate';
import { tokenCostUsd } from '@/lib/services/prices';

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
  pro:        { credits: 2500,  maxActiveMissions: 50,    modelTier: 'all',    maxStorageMb: 102_400,   governance: 'rbac',          isTrial: false, maxClarifications: 6, maxFanOutRoles: 99999,  schedulingEnabled: true },
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
  tool_call: 3,           // Composio API tool call (~$0.005/action × 4 markup × ₹86 ÷ ₹1/credit = 3 credits → 85% margin)
} as const;

/**
 * The real USD cost of an LLM call, from the providers' official prices (services/prices.ts),
 * including prompt-cache writes and reads.
 */
export function calculateRealCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cache: { cacheWriteTokens?: number; cacheReadTokens?: number } = {},
): number {
  return tokenCostUsd(model, { inputTokens, outputTokens, ...cache });
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
    .select('plan, credits_remaining, credits_topup, credits_total, credits_used_this_month, billing_status, model_tier, is_trial, monthly_credit_limit')
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

  // Enforce monthly spending cap — top-up credits bypass it (explicitly purchased, non-expiring)
  const monthlyLimit = billing?.monthly_credit_limit ?? null;
  const usedThisMonth = billing?.credits_used_this_month ?? 0;
  if (monthlyLimit !== null && usedThisMonth + cost > monthlyLimit && creditsTopup < cost) {
    return {
      allowed: false,
      plan,
      reason: `Monthly spending cap of ${monthlyLimit} credits reached (${usedThisMonth} used). Raise your cap in Usage & Credits or wait for next billing period.`,
      creditsRemaining: totalAvailable,
      creditsTotal: billing?.credits_total ?? 30,
    };
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
    .in('status', ['active', 'building']);

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
/** What a charge was for: the model call or service behind it, its real cost, and the run or build it belongs to. */
export interface ChargeMeta {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  /** Real cost to us in USD; computed from the tokens when not given. */
  realCostUsd?: number;
  markup?: MarkupKind;
  runId?: string;
  jobId?: string;
  missionId?: string;
  triggeredByUserId?: string;
}

export async function deductCredits(
  tenantId: string,
  amount: number,
  actionType: string,
  tokenMeta?: ChargeMeta
): Promise<void> {
  const supabase = createServiceClient();

  // Auto-provision billing record if missing
  await ensureBillingRecord(tenantId);

  // Atomic two-bucket deduction via DB function (no read-then-write race)
  const { data: rows, error } = await supabase.rpc('deduct_credits_atomic', {
    p_tenant_id:         tenantId,
    p_amount:            amount,
    p_check_monthly_cap: true,
  });

  if (error) throw new Error(`Credit deduction DB error: ${error.message}`);

  const result = Array.isArray(rows) ? rows[0] : rows;
  if (!result?.success) {
    throw new Error(result?.failure_reason ?? 'Insufficient credits');
  }

  // The real USD cost behind the charge: given, or from the tokens of the model call
  let realCostUsd = tokenMeta?.realCostUsd;
  if (realCostUsd === undefined && tokenMeta?.model && (tokenMeta.inputTokens || tokenMeta.outputTokens)) {
    realCostUsd = calculateRealCostUsd(tokenMeta.model, tokenMeta.inputTokens || 0, tokenMeta.outputTokens || 0, tokenMeta);
  }

  // Log credit usage event with attribution (non-critical, fire-and-forget)
  supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'billing.credit_used',
    entity_type: 'billing',
    entity_id: tenantId,
    triggered_by_user_id: tokenMeta?.triggeredByUserId ?? null,
    payload: {
      amount,
      actionType,
      remainingAfter: (result.new_monthly ?? 0) + (result.new_topup ?? 0),
      ...(tokenMeta ? {
        provider: tokenMeta.provider,
        model: tokenMeta.model,
        inputTokens: tokenMeta.inputTokens,
        outputTokens: tokenMeta.outputTokens,
        cacheWriteTokens: tokenMeta.cacheWriteTokens,
        cacheReadTokens: tokenMeta.cacheReadTokens,
        realCostUsd,
        markup: tokenMeta.markup,
        runId: tokenMeta.runId,
        jobId: tokenMeta.jobId,
        missionId: tokenMeta.missionId,
      } : {}),
    },
  }).then(() => {}, () => {});
}

// ── Real cost → credits ─────────────────────────────────────────────────────
// credits = real cost to us (USD) × live USD→INR rate × markup ÷ ₹ per credit, rounded up (min 1).
// Plans and packs are unchanged; only what each action deducts follows its real cost.
const INR_PER_CREDIT = 1;   // ₹1 per credit — update if plan pricing changes
/** Agent and mission work (building, writing and fixing code, runs, searches, app actions, images), chat, and failures. */
export const MARKUP = { work: 4, chat: 3, failure: 1.75 } as const;
export type MarkupKind = keyof typeof MARKUP;

/** Credits for a real cost at a markup. */
export async function creditsForCost(realCostUsd: number, kind: MarkupKind = 'work'): Promise<number> {
  const usdToInr = await getUsdToInr();
  return Math.max(1, Math.ceil((realCostUsd * usdToInr * MARKUP[kind]) / INR_PER_CREDIT));
}

type CacheTokens = { cacheWriteTokens?: number; cacheReadTokens?: number };

/** Credits for one LLM call inside an agent run or a build: real cost × 4. */
export async function calculateLLMCreditCost(model: string, inputTokens: number, outputTokens: number, cache: CacheTokens = {}): Promise<number> {
  return creditsForCost(calculateRealCostUsd(model, inputTokens, outputTokens, cache), 'work');
}

/** Credits for a provider charge priced per item (a generated image): real cost × 4. */
export async function calculateUsdCreditCost(realCostUsd: number): Promise<number> {
  return creditsForCost(realCostUsd, 'work');
}

/** Credits for one chat reply: real cost × 3. Never shown to the customer — the balance just decreases. */
export async function calculateChatCreditCost(inputTokens: number, outputTokens: number, model: string, cache: CacheTokens = {}): Promise<number> {
  return creditsForCost(calculateRealCostUsd(model, inputTokens, outputTokens, cache), 'chat');
}

/**
 * A failed run or build is billed at the failure markup (1.75×) instead of 4×: charges are taken as
 * the work happens, so this refunds the difference once it has failed. Safe to call more than once.
 * Returns the credits it was billed at in the end.
 */
export async function settleFailure(tenantId: string, ref: { runId?: string; jobId?: string }): Promise<{ charged: number; refunded: number }> {
  const key = ref.runId ? 'runId' : 'jobId';
  const id = ref.runId ?? ref.jobId;
  if (!id) return { charged: 0, refunded: 0 };
  const supabase = createServiceClient();
  const { data: done } = await supabase.from('events').select('payload')
    .eq('tenant_id', tenantId).eq('event_type', 'billing.failure_refund').eq(`payload->>${key}`, id).limit(1).maybeSingle();
  if (done) {
    const p = done.payload as { target?: number; refunded?: number };
    return { charged: p.target ?? 0, refunded: p.refunded ?? 0 };
  }
  const { data: rows } = await supabase.from('events').select('payload')
    .eq('tenant_id', tenantId).eq('event_type', 'billing.credit_used').eq(`payload->>${key}`, id).limit(2000);
  const charges = (rows ?? []).map(r => r.payload as { amount?: number; realCostUsd?: number; markup?: MarkupKind });
  const charged = charges.reduce((sum, c) => sum + (c.amount ?? 0), 0);
  if (charged === 0) return { charged: 0, refunded: 0 };
  // At the failure markup: from the real cost where recorded, else scaled down from the amount charged.
  const usdToInr = await getUsdToInr();
  const target = Math.max(1, Math.ceil(charges.reduce((sum, c) => sum + (
    typeof c.realCostUsd === 'number'
      ? (c.realCostUsd * usdToInr * MARKUP.failure) / INR_PER_CREDIT
      : (c.amount ?? 0) * MARKUP.failure / MARKUP[c.markup ?? 'work']
  ), 0)));
  const refunded = Math.max(0, charged - target);
  // Recorded first, so a second call never refunds twice.
  const { error } = await supabase.from('events').insert({
    tenant_id: tenantId, event_type: 'billing.failure_refund', entity_type: 'billing', entity_id: tenantId,
    payload: { [key]: id, chargedBefore: charged, target, refunded, markup: MARKUP.failure },
  });
  if (error) {
    console.warn('[Billing] Could not record the failure settlement:', error.message);
    return { charged, refunded: 0 };
  }
  if (refunded > 0) await addCredits(tenantId, refunded, `failure_rate:${key}:${id}`);
  return { charged: Math.min(charged, target), refunded };
}

/** Credits charged so far for a run or a build, after any failure refund. */
export async function creditsChargedFor(tenantId: string, ref: { runId?: string; jobId?: string }): Promise<number> {
  const key = ref.runId ? 'runId' : 'jobId';
  const id = ref.runId ?? ref.jobId;
  if (!id) return 0;
  const supabase = createServiceClient();
  const [{ data: used }, { data: refund }] = await Promise.all([
    supabase.from('events').select('payload').eq('tenant_id', tenantId).eq('event_type', 'billing.credit_used').eq(`payload->>${key}`, id).limit(2000),
    supabase.from('events').select('payload').eq('tenant_id', tenantId).eq('event_type', 'billing.failure_refund').eq(`payload->>${key}`, id).limit(1).maybeSingle(),
  ]);
  const charged = (used ?? []).reduce((sum, r) => sum + ((r.payload as { amount?: number }).amount ?? 0), 0);
  return charged - ((refund?.payload as { refunded?: number } | undefined)?.refunded ?? 0);
}

/**
 * Get the credit cost for an LLM model.
 */
export function getModelCreditCost(model: string): number {
  const flashModels = ['gemini-2.0-flash', 'gemini-flash', 'gpt-4o-mini', 'claude-haiku'];
  const proModels   = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-pro', 'gpt-4o', 'claude-sonnet'];
  const premiumModels = ['claude-opus', 'o1', 'o1-pro'];

  if (premiumModels.some(m => model.includes(m))) return CREDIT_COSTS.llm_call_premium;
  if (proModels.some(m => model.includes(m)))     return CREDIT_COSTS.llm_call_pro;
  if (flashModels.some(m => model.includes(m)))   return CREDIT_COSTS.llm_call_flash;
  return CREDIT_COSTS.llm_call_pro; // Default to pro — better to over-charge than under-charge
}

/**
 * Refund credits back to a tenant after an early-halt or system error.
 * Restores to monthly credits first and reduces the usage counter.
 */
export async function addCredits(tenantId: string, amount: number, reason: string): Promise<void> {
  const supabase = createServiceClient();
  // Atomic refund via DB function — avoids read-then-write race under concurrent execution
  const { error } = await supabase.rpc('add_credits_atomic_refund', {
    p_tenant_id: tenantId,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) {
    console.error(`[Billing] addCredits RPC failed for tenant ${tenantId}:`, error.message);
  }
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
