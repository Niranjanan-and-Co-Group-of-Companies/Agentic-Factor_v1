import { createServiceClient } from '../supabase/server';

// ============================================================
// Token Circuit Breaker
// Guards every LLM API call. Monitors real-time token spend
// and trips OPEN if per-mission or per-tenant budgets exceeded.
// States: CLOSED (normal) → OPEN (tripped) → HALF_OPEN (probe)
// ============================================================

export interface CircuitBreakerConfig {
  maxTokensPerMinute: number;   // Per-tenant rate limit (default: 100K)
  maxTokensPerMission: number;  // Per-mission budget (default: 500K)
  maxCostPerDay: number;        // Dollar ceiling per tenant/day (default: $50)
  tripThreshold: number;        // Consecutive failures before trip (default: 5)
  cooldownMs: number;           // Reset wait after trip (default: 60000)
  costPer1kTokens: number;      // Cost estimate (default: $0.005)
  creditMultiplier: number;      // Markup multiplier for credits (default: 4x)
  creditsPerDollar: number;      // Credits per $1 of cost (default: 1000)
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface TenantCircuit {
  state: CircuitState;
  tokensThisMinute: number;
  minuteWindowStart: number;
  consecutiveFailures: number;
  trippedAt: number | null;
  totalTokensToday: number;
  dayWindowStart: number;
}

interface MissionTokens {
  totalTokens: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxTokensPerMinute: 100_000,
  maxTokensPerMission: 500_000,
  maxCostPerDay: 50,
  tripThreshold: 5,
  cooldownMs: 60_000,
  costPer1kTokens: 0.005,
  creditMultiplier: 4,           // 4x markup for 80%+ profit margin
  creditsPerDollar: 1000,        // 1 dollar = 1000 base credits
};

// In-memory state (per-tenant and per-mission)
const tenantCircuits = new Map<string, TenantCircuit>();
const missionTokens = new Map<string, MissionTokens>();

function getTenantCircuit(tenantId: string): TenantCircuit {
  if (!tenantCircuits.has(tenantId)) {
    tenantCircuits.set(tenantId, {
      state: 'CLOSED',
      tokensThisMinute: 0,
      minuteWindowStart: Date.now(),
      consecutiveFailures: 0,
      trippedAt: null,
      totalTokensToday: 0,
      dayWindowStart: Date.now(),
    });
  }
  return tenantCircuits.get(tenantId)!;
}

function getMissionTokens(missionId: string): MissionTokens {
  if (!missionTokens.has(missionId)) {
    missionTokens.set(missionId, { totalTokens: 0 });
  }
  return missionTokens.get(missionId)!;
}

// ============================================================
// Pre-call check: can this LLM call proceed?
// ============================================================

export interface CircuitCheckResult {
  allowed: boolean;
  state: CircuitState;
  reason?: string;
  tenantTokensThisMinute: number;
  missionTokensTotal: number;
  estimatedDailyCost: number;
}

/**
 * Check if an LLM call is allowed under current circuit state.
 * Call this BEFORE every LLM API call.
 */
export function checkCircuit(
  tenantId: string,
  missionId: string,
  estimatedTokens: number = 0,
  config: Partial<CircuitBreakerConfig> = {}
): CircuitCheckResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const circuit = getTenantCircuit(tenantId);
  const mission = getMissionTokens(missionId);
  const now = Date.now();

  // Reset minute window if expired
  if (now - circuit.minuteWindowStart > 60_000) {
    circuit.tokensThisMinute = 0;
    circuit.minuteWindowStart = now;
  }

  // Reset day window if expired
  if (now - circuit.dayWindowStart > 86_400_000) {
    circuit.totalTokensToday = 0;
    circuit.dayWindowStart = now;
  }

  const estimatedDailyCost = (circuit.totalTokensToday / 1000) * cfg.costPer1kTokens;

  // Check OPEN state
  if (circuit.state === 'OPEN') {
    if (circuit.trippedAt && now - circuit.trippedAt > cfg.cooldownMs) {
      circuit.state = 'HALF_OPEN';
    } else {
      return { allowed: false, state: 'OPEN', reason: 'Circuit is OPEN — cooldown in progress', tenantTokensThisMinute: circuit.tokensThisMinute, missionTokensTotal: mission.totalTokens, estimatedDailyCost };
    }
  }

  // Check per-minute rate
  if (circuit.tokensThisMinute + estimatedTokens > cfg.maxTokensPerMinute) {
    trip(circuit, 'Per-minute token limit exceeded');
    return { allowed: false, state: 'OPEN', reason: `Per-minute limit exceeded: ${circuit.tokensThisMinute}/${cfg.maxTokensPerMinute}`, tenantTokensThisMinute: circuit.tokensThisMinute, missionTokensTotal: mission.totalTokens, estimatedDailyCost };
  }

  // Check per-mission budget
  if (mission.totalTokens + estimatedTokens > cfg.maxTokensPerMission) {
    return { allowed: false, state: circuit.state, reason: `Per-mission budget exceeded: ${mission.totalTokens}/${cfg.maxTokensPerMission}`, tenantTokensThisMinute: circuit.tokensThisMinute, missionTokensTotal: mission.totalTokens, estimatedDailyCost };
  }

  // Check daily cost ceiling
  const projectedCost = ((circuit.totalTokensToday + estimatedTokens) / 1000) * cfg.costPer1kTokens;
  if (projectedCost > cfg.maxCostPerDay) {
    trip(circuit, 'Daily cost ceiling exceeded');
    return { allowed: false, state: 'OPEN', reason: `Daily cost ceiling exceeded: $${projectedCost.toFixed(2)}/$${cfg.maxCostPerDay}`, tenantTokensThisMinute: circuit.tokensThisMinute, missionTokensTotal: mission.totalTokens, estimatedDailyCost: projectedCost };
  }

  // HALF_OPEN probe succeeds → close circuit
  if (circuit.state === 'HALF_OPEN') {
    circuit.state = 'CLOSED';
    circuit.consecutiveFailures = 0;
  }

  return { allowed: true, state: circuit.state, tenantTokensThisMinute: circuit.tokensThisMinute, missionTokensTotal: mission.totalTokens, estimatedDailyCost };
}

function trip(circuit: TenantCircuit, reason: string): void {
  circuit.state = 'OPEN';
  circuit.trippedAt = Date.now();
  console.warn(`[CircuitBreaker] TRIPPED: ${reason}`);
}

// ============================================================
// Post-call: record token usage
// ============================================================

/**
 * Record token usage after a successful LLM call.
 */
export async function recordUsage(
  tenantId: string,
  missionId: string,
  tokensUsed: number,
  callType: string = 'llm_call'
): Promise<void> {
  const circuit = getTenantCircuit(tenantId);
  const mission = getMissionTokens(missionId);

  circuit.tokensThisMinute += tokensUsed;
  circuit.totalTokensToday += tokensUsed;
  circuit.consecutiveFailures = 0;
  mission.totalTokens += tokensUsed;

  // Persist to events table for audit
  try {
    const supabase = createServiceClient();
    await supabase.from('events').insert({
      tenant_id: tenantId,
      event_type: 'token.usage_recorded',
      entity_type: 'mission',
      entity_id: missionId,
      payload: { tokensUsed, callType, tenantMinuteTotal: circuit.tokensThisMinute, missionTotal: mission.totalTokens, creditsUsed: Math.ceil((tokensUsed / 1000) * DEFAULT_CONFIG.costPer1kTokens * DEFAULT_CONFIG.creditMultiplier * DEFAULT_CONFIG.creditsPerDollar) },
    });
  } catch (err) {
    console.error('[CircuitBreaker] Failed to log usage:', err);
  }
}

/**
 * Record a failed LLM call. Consecutive failures trip the breaker.
 */
export function recordFailure(tenantId: string, config: Partial<CircuitBreakerConfig> = {}): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const circuit = getTenantCircuit(tenantId);
  circuit.consecutiveFailures++;
  if (circuit.consecutiveFailures >= cfg.tripThreshold) {
    trip(circuit, `${circuit.consecutiveFailures} consecutive failures`);
  }
}

/**
 * Get current circuit status for dashboard display.
 */
export function getCircuitStatus(tenantId: string): { state: CircuitState; tokensThisMinute: number; totalTokensToday: number; estimatedDailyCost: number; estimatedCreditsUsed: number; consecutiveFailures: number } {
  const circuit = getTenantCircuit(tenantId);
  return {
    state: circuit.state,
    tokensThisMinute: circuit.tokensThisMinute,
    totalTokensToday: circuit.totalTokensToday,
    estimatedDailyCost: (circuit.totalTokensToday / 1000) * DEFAULT_CONFIG.costPer1kTokens,
    estimatedCreditsUsed: Math.ceil((circuit.totalTokensToday / 1000) * DEFAULT_CONFIG.costPer1kTokens * DEFAULT_CONFIG.creditMultiplier * DEFAULT_CONFIG.creditsPerDollar),
    consecutiveFailures: circuit.consecutiveFailures,
  };
}

/** Reset circuit (admin use / testing). */
export function resetCircuit(tenantId: string): void {
  tenantCircuits.delete(tenantId);
}

/** Reset mission token counter (admin use / testing). */
export function resetMissionTokens(missionId: string): void {
  missionTokens.delete(missionId);
}
