// ============================================================
// Circuit Breaker — Token & Cost Safety
//
// Three states: CLOSED (normal), OPEN (tripped), HALF_OPEN (testing)
// Monitors: per-minute token rate + per-mission cost + daily cost
//
// $1.00 HARD LIMIT for first test run
// ============================================================

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface UsageRecord {
  tokens: number;
  cost: number;
  timestamp: number;
}

interface CircuitBreakerConfig {
  maxTokensPerMinute: number;
  maxCostPerMission: number;
  dailyCostCeiling: number;
  halfOpenRetryMs: number;
}

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private records: UsageRecord[] = [];
  private dailyCost = 0;
  private missionCosts: Map<string, number> = new Map();
  private lastTripTime = 0;
  private config: CircuitBreakerConfig;

  constructor() {
    this.config = {
      maxTokensPerMinute: parseInt(process.env.CB_MAX_TOKENS_PER_MINUTE || '50000', 10),
      maxCostPerMission: parseFloat(process.env.CB_MAX_COST_PER_MISSION_USD || '1.00'),
      dailyCostCeiling: parseFloat(process.env.CB_DAILY_COST_CEILING_USD || '1.00'),
      halfOpenRetryMs: 60_000, // 1 minute before testing again
    };
  }

  getState(): CircuitState {
    if (this.state === 'OPEN') {
      // Auto-transition to HALF_OPEN after cooldown
      if (Date.now() - this.lastTripTime > this.config.halfOpenRetryMs) {
        this.state = 'HALF_OPEN';
      }
    }
    return this.state;
  }

  getUsage() {
    const now = Date.now();
    const oneMinAgo = now - 60_000;
    const recentTokens = this.records
      .filter((r) => r.timestamp > oneMinAgo)
      .reduce((sum, r) => sum + r.tokens, 0);

    return {
      state: this.getState(),
      tokensPerMinute: recentTokens,
      maxTokensPerMinute: this.config.maxTokensPerMinute,
      dailyCost: this.dailyCost,
      dailyCeiling: this.config.dailyCostCeiling,
      missionCosts: Object.fromEntries(this.missionCosts),
      maxCostPerMission: this.config.maxCostPerMission,
    };
  }

  /**
   * Record token usage for a mission. Returns false if the circuit trips.
   */
  recordUsage(missionId: string, tokens: number, costUsd: number): { allowed: boolean; reason?: string } {
    const currentState = this.getState();

    // OPEN state — reject everything
    if (currentState === 'OPEN') {
      return { allowed: false, reason: `Circuit OPEN — tripped at ${new Date(this.lastTripTime).toISOString()}. Retry in ${Math.ceil((this.config.halfOpenRetryMs - (Date.now() - this.lastTripTime)) / 1000)}s` };
    }

    // Record the usage
    this.records.push({ tokens, cost: costUsd, timestamp: Date.now() });
    this.dailyCost += costUsd;
    this.missionCosts.set(missionId, (this.missionCosts.get(missionId) || 0) + costUsd);

    // Clean old records (keep last 5 minutes)
    const fiveMinAgo = Date.now() - 300_000;
    this.records = this.records.filter((r) => r.timestamp > fiveMinAgo);

    // ── Check: Per-minute token rate ──
    const oneMinAgo = Date.now() - 60_000;
    const minuteTokens = this.records
      .filter((r) => r.timestamp > oneMinAgo)
      .reduce((sum, r) => sum + r.tokens, 0);

    if (minuteTokens > this.config.maxTokensPerMinute) {
      return this.trip(`Token rate exceeded: ${minuteTokens}/${this.config.maxTokensPerMinute} per minute`);
    }

    // ── Check: Per-mission cost ──
    const missionCost = this.missionCosts.get(missionId) || 0;
    if (missionCost > this.config.maxCostPerMission) {
      return this.trip(`Mission ${missionId} cost exceeded: $${missionCost.toFixed(4)}/$${this.config.maxCostPerMission}`);
    }

    // ── Check: Daily cost ceiling ──
    if (this.dailyCost > this.config.dailyCostCeiling) {
      return this.trip(`Daily cost exceeded: $${this.dailyCost.toFixed(4)}/$${this.config.dailyCostCeiling}`);
    }

    // HALF_OPEN state — one successful call closes the circuit
    if (currentState === 'HALF_OPEN') {
      this.state = 'CLOSED';
    }

    return { allowed: true };
  }

  private trip(reason: string): { allowed: false; reason: string } {
    this.state = 'OPEN';
    this.lastTripTime = Date.now();
    console.error(`[CircuitBreaker] TRIPPED: ${reason}`);
    return { allowed: false, reason };
  }

  /** Manual reset (admin action) */
  reset() {
    this.state = 'CLOSED';
    this.dailyCost = 0;
    this.missionCosts.clear();
    this.records = [];
  }
}

// Singleton — shared across all API routes in the same process
export const circuitBreaker = new CircuitBreaker();
