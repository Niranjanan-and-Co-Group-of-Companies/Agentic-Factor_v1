// What each plan gives an account, wherever it was bought (website or app store), and the free plan an
// account moves to when its plan ends. Mirrors PLAN_DEFAULTS in middleware/billing.ts.

export interface PlanGrant {
  credits: number;            // per month (per seat on Pro)
  maxActiveMissions: number;
  modelTier: string;
  maxStorageMb: number;
  governance: string;
  annual?: boolean;
  basePlan?: string;
}

export const PLAN_CONFIGS: Record<string, PlanGrant> = {
  free:               { credits: 30,    maxActiveMissions: 1,     modelTier: 'flash',  maxStorageMb: 100,       governance: 'none' },
  individual:         { credits: 1000,  maxActiveMissions: 5,     modelTier: 'mixed',  maxStorageMb: 10_240,    governance: 'basic_memory' },
  individual_annual:  { credits: 1000,  maxActiveMissions: 5,     modelTier: 'mixed',  maxStorageMb: 10_240,    governance: 'basic_memory', annual: true, basePlan: 'individual' },
  pro:                { credits: 2500,  maxActiveMissions: 50,    modelTier: 'all',    maxStorageMb: 102_400,   governance: 'rbac' },
  pro_annual:         { credits: 2500,  maxActiveMissions: 50,    modelTier: 'all',    maxStorageMb: 102_400,   governance: 'rbac', annual: true, basePlan: 'pro' },
  enterprise:         { credits: 99999, maxActiveMissions: 99999, modelTier: 'custom', maxStorageMb: 1_048_576, governance: 'full_audit' },
};

/** The billing fields of an account moved to the free plan (top-up credits are kept, frozen). */
export function freePlanFields(status: string) {
  const free = PLAN_CONFIGS.free;
  return {
    plan: 'free',
    billing_status: status,
    credits_remaining: 0,
    credits_total: 0,
    max_active_missions: free.maxActiveMissions,
    model_tier: free.modelTier,
    max_storage_mb: free.maxStorageMb,
    governance: free.governance,
    is_trial: false,
    updated_at: new Date().toISOString(),
  };
}
