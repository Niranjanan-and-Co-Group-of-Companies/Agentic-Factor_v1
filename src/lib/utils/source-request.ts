/**
 * The customer's own words for a mission. Command Center hands the architect an LLM-written
 * `intent`, which summarises: a proposal mission got "quotes" from a sales-call transcript the
 * architect never saw, reworded and partly invented. Their recent messages now travel verbatim with
 * the intent and are saved on the mission (mission_json.sourceRequest), so the architect, later
 * blueprint edits and the critic all work from what the customer actually wrote.
 */

export const CUSTOMER_WORDS_HEADING =
  "THE CUSTOMER'S OWN WORDS (verbatim — take their data, names, numbers and any text to quote exactly from here; never reword a quote):";

/** The last few user messages, newest kept whole first, capped at `max` characters. */
export function customerWords(messages: Array<{ role: string; content: unknown }>, max = 12_000): string {
  const texts = messages
    .filter(m => m.role === 'user' && typeof m.content === 'string' && m.content.trim())
    .map(m => (m.content as string).trim())
    .slice(-3);
  const kept: string[] = [];
  let budget = max;
  for (const text of texts.reverse()) {
    if (budget <= 0) break;
    kept.unshift(text.length > budget ? text.slice(0, budget) : text);
    budget -= text.length;
  }
  return kept.join('\n\n---\n\n');
}

export function withCustomerWords(intent: string, words: string | undefined): string {
  return words?.trim() ? `${intent}\n\n${CUSTOMER_WORDS_HEADING}\n${words.trim()}` : intent;
}
