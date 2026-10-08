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
  return JSON.stringify({ ...(top as Record<string, unknown>), _pipeline: ordered });
}
