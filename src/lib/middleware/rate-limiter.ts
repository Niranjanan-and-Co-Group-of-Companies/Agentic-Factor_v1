// ============================================================
// API Rate Limiter — In-Memory Sliding Window
// Protects all /api/* routes from abuse.
// Production: Replace with Redis/Upstash for distributed rate limiting.
// ============================================================

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, entry] of rateLimitStore) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) rateLimitStore.delete(key);
  }
}, 300_000);

export interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;    // Max requests per window
}

// Plan-based rate limits
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'free':       { windowMs: 60_000, maxRequests: 10 },     // 10 req/min
  'individual': { windowMs: 60_000, maxRequests: 30 },     // 30 req/min
  'pro':        { windowMs: 60_000, maxRequests: 60 },     // 60 req/min
  'enterprise': { windowMs: 60_000, maxRequests: 200 },    // 200 req/min
  'anonymous':  { windowMs: 60_000, maxRequests: 5 },      // 5 req/min for unauthenticated
};

/**
 * Check if a request should be rate limited.
 * Returns { allowed: true } or { allowed: false, retryAfter: seconds }.
 */
export function checkRateLimit(
  identifier: string,
  plan: string = 'free'
): { allowed: boolean; remaining: number; retryAfter?: number } {
  const config = RATE_LIMITS[plan] || RATE_LIMITS['free'];
  const now = Date.now();
  const windowStart = now - config.windowMs;

  let entry = rateLimitStore.get(identifier);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(identifier, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => t > windowStart);

  if (entry.timestamps.length >= config.maxRequests) {
    // Rate limited
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = (oldestInWindow + config.windowMs) - now;
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil(retryAfterMs / 1000),
    };
  }

  // Allow and record
  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: config.maxRequests - entry.timestamps.length,
  };
}

/**
 * Build rate limit response headers.
 */
export function rateLimitHeaders(
  plan: string,
  remaining: number,
  retryAfter?: number
): Record<string, string> {
  const config = RATE_LIMITS[plan] || RATE_LIMITS['free'];
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(config.maxRequests),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Window': String(config.windowMs / 1000),
  };
  if (retryAfter !== undefined) {
    headers['Retry-After'] = String(retryAfter);
  }
  return headers;
}
