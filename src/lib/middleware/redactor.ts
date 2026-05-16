// ============================================================
// Confidentiality Redactor Middleware
// Masks sensitive strings in proposed_actions before HITL queue.
// ============================================================

export interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
  category: 'api_key' | 'pii' | 'credential' | 'confidential';
}

export interface RedactionResult {
  redactedPayload: Record<string, unknown>;
  redactionCount: number;
  redactedFields: string[];
  summary: string;
}

const DEFAULT_RULES: RedactionRule[] = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED:aws_key]', category: 'api_key' },
  { name: 'Bearer Token', pattern: /Bearer\s+[A-Za-z0-9_\-.]{20,}/gi, replacement: 'Bearer [REDACTED:token]', category: 'credential' },
  { name: 'Generic API Key', pattern: /(?:api[_-]?key|secret_key|access_token)[\s]*[=:]\s*["']?([A-Za-z0-9_\-]{20,})["']?/gi, replacement: '[REDACTED:api_key]', category: 'api_key' },
  { name: 'Email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[REDACTED:email]', category: 'pii' },
  { name: 'Phone', pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: '[REDACTED:phone]', category: 'pii' },
  { name: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED:ssn]', category: 'pii' },
  { name: 'Credit Card', pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: '[REDACTED:cc]', category: 'pii' },
  { name: 'Connection String', pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s]+/gi, replacement: '[REDACTED:conn_string]', category: 'credential' },
  { name: 'Password Field', pattern: /(?:password|passwd|pwd)[\s]*[=:]\s*["']?[^\s"',}{]{4,}["']?/gi, replacement: '[REDACTED:password]', category: 'credential' },
];

function redactString(value: string, rules: RedactionRule[]): { redacted: string; matches: string[] } {
  let redacted = value;
  const matches: string[] = [];
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(redacted)) {
      matches.push(rule.name);
      rule.pattern.lastIndex = 0;
      redacted = redacted.replace(rule.pattern, rule.replacement);
    }
  }
  return { redacted, matches };
}

function redactObject(
  obj: unknown, rules: RedactionRule[], path = '',
  results = { redactedFields: [] as string[], count: 0 }
): { value: unknown; results: typeof results } {
  if (typeof obj === 'string') {
    const { redacted, matches } = redactString(obj, rules);
    if (matches.length > 0) { results.count += matches.length; results.redactedFields.push(`${path} (${matches.join(', ')})`); }
    return { value: redacted, results };
  }
  if (Array.isArray(obj)) {
    return { value: obj.map((item, i) => redactObject(item, rules, `${path}[${i}]`, results).value), results };
  }
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'secret', 'token', 'api_key', 'apikey', 'private_key'];
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        out[key] = `[REDACTED:${key}]`; results.count++; results.redactedFields.push(`${path}.${key}`);
      } else {
        out[key] = redactObject(val, rules, `${path}.${key}`, results).value;
      }
    }
    return { value: out, results };
  }
  return { value: obj, results };
}

/** Redact a payload using default + custom rules. */
export function redactPayload(payload: Record<string, unknown>, customRules: RedactionRule[] = []): RedactionResult {
  const rules = [...DEFAULT_RULES, ...customRules];
  const { value, results } = redactObject(payload, rules);
  return {
    redactedPayload: value as Record<string, unknown>,
    redactionCount: results.count,
    redactedFields: results.redactedFields,
    summary: results.count > 0 ? `Redacted ${results.count} sensitive value(s)` : 'No sensitive data detected',
  };
}

/** Escalated redaction for confidential/restricted levels — replaces entire payload. */
export function redactForHITL(
  payload: Record<string, unknown>,
  confidentialityLevel: 'public' | 'internal' | 'confidential' | 'restricted',
  customRules: RedactionRule[] = []
): RedactionResult {
  if (confidentialityLevel === 'confidential' || confidentialityLevel === 'restricted') {
    return {
      redactedPayload: { _redacted: true, _level: confidentialityLevel, _keys: Object.keys(payload) },
      redactionCount: Object.keys(payload).length,
      redactedFields: ['[entire_payload]'],
      summary: `Full payload redacted at ${confidentialityLevel} level`,
    };
  }
  return redactPayload(payload, customRules);
}
