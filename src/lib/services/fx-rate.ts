// Live USD → INR exchange rate, cached in-memory for 4 hours.
// Used by billing to protect margin when INR weakens against USD.
// Provider: Frankfurter (European Central Bank data, free, no API key).

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const FALLBACK_USD_INR = 87; // conservative: slightly higher than real rate, safe for margin
const MIN_VALID = 70;
const MAX_VALID = 120;

let _cache: { rate: number; fetchedAt: number } | null = null;

export async function getUsdToInr(): Promise<number> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.rate;
  }

  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR', {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'AgenticFactor/1.0' },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { rates?: { INR?: number } };
    const rate = data?.rates?.INR;

    if (!rate || rate < MIN_VALID || rate > MAX_VALID) {
      throw new Error(`Implausible rate: ${rate}`);
    }

    _cache = { rate, fetchedAt: Date.now() };
    return rate;
  } catch (err) {
    console.warn('[fx-rate] Failed to fetch live USD/INR rate:', err);
    // Return stale cache if available — stale is better than fallback constant
    return _cache?.rate ?? FALLBACK_USD_INR;
  }
}

// Expose cached rate for display (Usage & Credits page etc.) — never call in hot path
export function getCachedUsdToInr(): { rate: number; fetchedAt: Date | null } {
  return {
    rate: _cache?.rate ?? FALLBACK_USD_INR,
    fetchedAt: _cache ? new Date(_cache.fetchedAt) : null,
  };
}
