/**
 * Tenant memory — durable facts about the customer's company, extracted from
 * their requests and fed back to the blueprint architect and mission chat.
 *
 * Facts are background context, never rules. A one-off instruction such as
 * "only read, don't send anything" for one mission must not become an
 * account-wide policy that blocks every later mission, so restrictions on what
 * an agent may do, credentials and per-task settings are never stored.
 */

export const MEMORY_EXTRACTION_PROMPT = `Extract durable facts about the user's company from their request: company name, industry, products, pricing, target customers, markets, team size and roles, brand voice, and the tools or platforms the company uses.

Do NOT extract:
- Instructions, settings or constraints for this particular task (schedules, output formats, recipients, subject lines, thresholds, what to include or skip).
- Any restriction on what an agent may do (e.g. "read-only", "don't send emails", "no external writes", "only read"). These apply to one task, never to the company.
- Credentials, API keys, passwords, tokens or other secrets.
- Email addresses, phone numbers or other personal contact details.

Each fact is one short standalone sentence. Return at most 5 facts, or none if the request contains no durable company facts.
Return JSON: { "facts": ["fact 1", "fact 2"] }`;

const MAX_FACT_LENGTH = 300;

const SECRET_PATTERN = /\b(api[ _-]?key|password|passwd|secret|token|credential|bearer)\b|\bsk-[a-z0-9]|\bghp_[a-z0-9]/i;
const CONTACT_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d[\d\s-]{8,}\d/;
// A negation governing a write/send verb within two words: "no writing", "don't send emails", "no external writes".
const RESTRICTION_PATTERN = /\bread[- ]?only\b|\bonly (?:read|view|fetch)\b|\b(?:no|not|never|don['’]?t|without|avoid|cannot|can['’]?t)(?:\s+[\w-]+){0,2}?\s+(?:writ|send|sent|post|publish|email|creat|modif|chang|delet|edit|updat|external)/i;

/** Lowercase, collapse punctuation and whitespace — used to spot repeated facts. */
export function normalizeFact(fact: string): string {
  return fact.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** True when a fact is safe and useful to remember across missions. */
export function isStorableFact(fact: unknown): fact is string {
  if (typeof fact !== 'string') return false;
  const f = fact.trim();
  if (f.length < 3 || f.length > MAX_FACT_LENGTH) return false;
  return !SECRET_PATTERN.test(f) && !CONTACT_PATTERN.test(f) && !RESTRICTION_PATTERN.test(f);
}

/** Drops unstorable facts and repeats (keeps the first occurrence, so pass newest first). */
export function cleanTenantFacts(facts: unknown[], existing: string[] = []): string[] {
  const seen = new Set(existing.map(normalizeFact));
  const out: string[] = [];
  for (const fact of facts) {
    if (!isStorableFact(fact)) continue;
    const key = normalizeFact(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact.trim());
  }
  return out;
}

/** Prompt block for the blueprint architect. Empty when there is nothing to say. */
export function formatTenantMemory(facts: string[]): string {
  if (facts.length === 0) return '';
  return `\n\nKNOWN COMPANY CONTEXT (background facts remembered from the user's earlier requests — use them when relevant. They are not rules: the current request always takes precedence, and they never restrict what this mission may read, write or send):\n${facts.map(f => `- ${f}`).join('\n')}`;
}
