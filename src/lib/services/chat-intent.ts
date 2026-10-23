// Whether a request asks for something to happen regularly or automatically — a mission — rather than
// once. The Command Center's assistant decides this itself; this is the safety net under it: a
// recurring request always ends in a mission (built, or offered with one tap), never a one-off answer.

const DAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekend';
const UNITS = 'minute|hour|day|morning|afternoon|evening|night|week|fortnight|month|quarter|year';

const RECURRING: RegExp[] = [
  new RegExp(`\\bevery\\s+(?:(?:other|single|\\d+)\\s+)?(?:${UNITS}|${DAYS})s?\\b`, 'i'),
  new RegExp(`\\b(?:each|per)\\s+(?:${UNITS}|${DAYS})\\b`, 'i'),
  new RegExp(`\\b(?:on|at)\\s+(?:${DAYS})s\\b`, 'i'), // "on Mondays"
  /\b(?:daily|weekly|monthly|hourly|nightly|fortnightly|quarterly|yearly|annually|weekdays)\b/i,
  /\b(?:whenever|every\s+time|each\s+time|as\s+soon\s+as)\b/i,
  /\b(?:recurring|regularly|on\s+a\s+schedule|automatically|automate[ds]?|automation)\b/i,
  /\bschedule\s+(?:it|this|that|them)\b|\bput\s+(?:it|this|that)\s+on\s+a\s+schedule\b/i,
  /\bkeep\s+(?:me\s+)?(?:updated|posted|track(?:ing)?|an\s+eye)\b|\bmonitor(?:ing)?\b|\bwatch\s+(?:for|out\s+for)\b/i,
  /\b(?:build|create|make|set\s+up|setup)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:mission|agent|bot|workflow|automation|pipeline)s?\b/i,
];

const ONCE: RegExp[] = [
  /\b(?:just|only)\s+(?:once|this\s+once|one\s+time|for\s+now|this\s+time)\b/i,
  /\bone[-\s]?(?:time|off)\b/i,
  /\bnot\s+(?:regularly|every\s+time|recurring)\b/i,
];

/** The request asks for something to happen regularly or automatically. */
export function asksForRecurring(text: string): boolean {
  if (ONCE.some(p => p.test(text))) return false;
  return RECURRING.some(p => p.test(text));
}

/** Told to the assistant for this turn when the request is recurring. */
export const RECURRING_NOTE = `THIS MESSAGE asks for something to happen regularly or automatically, so it becomes a mission: emit create_mission (ask at most one essential question first). If it also wants a result now ("today's", "right now", "and send me this week's"), do that part here as well — read with the app tools, and if a step needs the customer's OK, call propose_app_actions with its "mission" field set, so the mission is built at the same time.`;
