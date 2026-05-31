// ============================================================
// Robust JSON parser — extracts valid JSON from messy LLM output
// Handles: markdown wrappers, debug text, trailing commas,
//          unclosed brackets, mixed text+JSON, error messages
// ============================================================

/**
 * Attempt to parse a string as JSON with multiple repair strategies.
 * Returns the parsed object or throws with a clear error message.
 */
export function robustJSONParse(raw: string): Record<string, unknown> {
  // Strategy 1: Direct parse
  try {
    return JSON.parse(raw);
  } catch { /* continue */ }

  // Strategy 2: Strip markdown code fences
  let cleaned = raw
    .replace(/^```json?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch { /* continue */ }

  // Strategy 3: Extract JSON object from mixed text (find first { ... last })
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const extracted = cleaned.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(extracted);
    } catch { /* continue */ }

    // Strategy 4: Repair the extracted JSON
    try {
      return JSON.parse(repairJSON(extracted));
    } catch { /* continue */ }
  }

  // Strategy 5: Extract JSON array from mixed text
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const extracted = cleaned.substring(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(extracted) as Record<string, unknown>;
    } catch { /* continue */ }
  }

  // Strategy 6: Full repair on original cleaned text
  try {
    return JSON.parse(repairJSON(cleaned));
  } catch { /* continue */ }

  // All strategies failed — throw with helpful context
  const preview = raw.substring(0, 100).replace(/\n/g, ' ');
  throw new Error(
    `Failed to extract valid JSON from LLM response after 6 repair strategies. ` +
    `Preview: "${preview}..."`
  );
}

/**
 * Apply common JSON repair heuristics.
 */
function repairJSON(str: string): string {
  let repaired = str;

  // Remove trailing commas before ] or }
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');

  // Fix missing commas between adjacent objects: }  {
  repaired = repaired.replace(/}\s*{/g, '},{');

  // Fix missing commas between adjacent strings: "foo"  "bar"
  repaired = repaired.replace(/"\s*\n\s*"/g, '",\n"');

  // Remove control characters that break JSON
  repaired = repaired.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // Close unclosed brackets/braces
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  repaired += '}'.repeat(Math.max(0, openBraces - closeBraces));
  repaired += ']'.repeat(Math.max(0, openBrackets - closeBrackets));

  return repaired;
}

/**
 * Safely extract JSON from LLM output, returning a default if all parsing fails.
 * Use this when you want a fallback instead of throwing.
 */
export function safeJSONParse(
  raw: string,
  fallback: Record<string, unknown> = {}
): Record<string, unknown> {
  try {
    return robustJSONParse(raw);
  } catch {
    return fallback;
  }
}
