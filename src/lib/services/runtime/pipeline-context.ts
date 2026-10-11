/**
 * Input for the next agent in a pipeline: the previous agent's output (unchanged at the top level, as
 * scripts expect) plus `_pipeline` — every earlier agent's output keyed by role.
 *
 * Without it, data didn't accumulate: in a competitor audit with one researcher per brand, the final
 * Sheets writer received only the last brand, so it could either leave two brands out or invent them.
 * Added only when the previous output is a JSON object, so other shapes pass through untouched.
 */
const MAX_PIPELINE_CHARS = 60_000;

export function withPipelineHistory(
  output: string,
  earlier: Array<{ role: string; output: string }>,
): string {
  if (earlier.length === 0) return output;
  let top: unknown;
  try { top = JSON.parse(output); } catch { return output; }
  if (!top || typeof top !== 'object' || Array.isArray(top)) return output;

  const parse = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };
  // Newest first, so the earliest outputs are the ones dropped when the history gets too large.
  const pipeline: Record<string, unknown> = {};
  let size = 0;
  for (const step of [...earlier].reverse()) {
    const value = parse(step.output);
    const len = JSON.stringify(value)?.length ?? 0;
    if (size + len > MAX_PIPELINE_CHARS) break;
    pipeline[step.role] = value;
    size += len;
  }
  const ordered = Object.fromEntries(earlier.filter(s => s.role in pipeline).map(s => [s.role, pipeline[s.role]]));
  // Earlier agents' top-level fields are also merged in (oldest first, the previous agent's own
  // fields win): a compiler that read input_data["github_summary"] found nothing — the GitHub
  // results were only under _pipeline — and emailed "0 commits across 0 repos".
  const merged: Record<string, unknown> = {};
  for (const value of Object.values(ordered)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(merged, value);
  }
  return JSON.stringify({ ...merged, ...(top as Record<string, unknown>), _pipeline: ordered });
}

/**
 * The input as the critic should see it. It used to get the first 1500 characters, which cut off
 * _pipeline: a Sheets writer that correctly compiled three brands was failed for "fabricating" two of
 * them because the critic only saw the last brand. Show each part, each shortened.
 */
export function criticInputView(inputContext: string, perPart = 1200, total = 7000): string {
  let parsed: unknown;
  try { parsed = JSON.parse(inputContext); } catch { return inputContext.slice(0, 1500); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('_pipeline' in parsed)) {
    return inputContext.slice(0, 1500);
  }
  const { _pipeline, ...previous } = parsed as Record<string, unknown> & { _pipeline: Record<string, unknown> };
  const parts = [`From the previous agent:\n${JSON.stringify(previous).slice(0, perPart)}`];
  for (const [role, value] of Object.entries(_pipeline ?? {})) {
    parts.push(`From earlier agent "${role}":\n${(typeof value === 'string' ? value : JSON.stringify(value)).slice(0, perPart)}`);
  }
  return parts.join('\n\n').slice(0, total);
}

/**
 * The agent's output as the critic reads it, bounded. A Zoho export step handed the critic the whole
 * year of records (~170K tokens, ~185 credits per review) — twice, because the next step passed its
 * input through. Small outputs are unchanged; otherwise fields passed through unchanged from earlier
 * agents are named instead of repeated, long lists keep their first items and their count, and long
 * text keeps up to 12K characters (the critic judges written text).
 */
export function criticOutputView(output: string, inputContext = '', maxChars = 30_000): string {
  if (output.length <= maxChars) return output;
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch { return `${output.slice(0, maxChars)}\n…(output cut at ${maxChars} of ${output.length} characters)`; }
  if (!parsed || typeof parsed !== 'object') return output.slice(0, maxChars);

  let given: Record<string, unknown> = {};
  try {
    const p = JSON.parse(inputContext);
    if (p && typeof p === 'object' && !Array.isArray(p)) given = p;
  } catch { /* no input */ }
  let view: unknown = parsed;
  const passedThrough: string[] = [];
  if (!Array.isArray(parsed)) {
    view = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([k, v]) => {
      const same = k === '_pipeline' || (k in given && JSON.stringify(given[k]) === JSON.stringify(v));
      if (same && k !== '_pipeline') passedThrough.push(k);
      return !same;
    }));
  }

  const shrink = (v: unknown, keep: number, textMax: number): unknown => {
    if (typeof v === 'string') return v.length > textMax ? `${v.slice(0, textMax)}…(${v.length} characters)` : v;
    if (Array.isArray(v)) {
      const items = v.slice(0, keep).map(x => shrink(x, keep, textMax));
      return v.length > keep ? [...items, `…${v.length - keep} more items (${v.length} in total)`] : items;
    }
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shrink(x, keep, textMax)]));
    return v;
  };
  const note = passedThrough.length ? `\n(Passed through unchanged from earlier agents, not repeated here: ${passedThrough.join(', ')})` : '';
  for (const [keep, textMax] of [[8, 12_000], [4, 6_000], [2, 3_000]] as const) {
    const text = JSON.stringify(shrink(view, keep, textMax), null, 1);
    if (text.length + note.length <= maxChars) return `${text}${note}\n(Long lists show their first ${keep} items and their total count.)`;
  }
  return `${JSON.stringify(shrink(view, 2, 3_000)).slice(0, maxChars)}…${note}`;
}

/**
 * A compact picture of the data a script receives, for the fixer. Without it the fixer could only
 * guess field names: a weekly-update compiler was rewritten seven times and kept reporting
 * "0 commits across 0 repos" while its input held github_summary.commits.count = 2.
 */
export function describeInputShape(inputContext: string, maxChars = 2500): string {
  if (!inputContext.trim()) return '(empty — this is the first agent)';
  let parsed: unknown;
  try { parsed = JSON.parse(inputContext); } catch { return inputContext.slice(0, 600); }
  const shrink = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v;
    if (Array.isArray(v)) return depth > 3 ? `[${v.length} items]` : [...v.slice(0, 2).map(x => shrink(x, depth + 1)), ...(v.length > 2 ? [`…${v.length - 2} more`] : [])];
    if (v && typeof v === 'object') {
      if (depth > 3) return '{…}';
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shrink(x, depth + 1)]));
    }
    return v;
  };
  // _pipeline repeats fields that are already merged in at the top level.
  const top = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([k]) => k !== '_pipeline'))
    : parsed;
  return JSON.stringify(shrink(top, 0), null, 1).slice(0, maxChars);
}
