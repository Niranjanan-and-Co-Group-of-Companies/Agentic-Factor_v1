/**
 * Checks the writes a preview deferred against Composio's own action schemas before anything runs
 * for real. A Zoho Books step sent account_type "other_current_liability" — outside the action's
 * allowed values — and only found out in the live run, one retry per run, three runs per quarter.
 */
import { getComposioActionSchemas, toolkitForAction } from '../composio-actions';
import type { DeferredWrite } from './agent-loop';

interface ActionSchema {
  input_parameters?: { properties?: Record<string, { enum?: unknown[] }>; required?: string[] };
}

/** Problems with one deferred call: unknown parameters, missing required ones, values outside an enum. */
export function schemaProblems(action: string, params: unknown, schema: ActionSchema): string[] {
  const props = schema.input_parameters?.properties ?? {};
  const names = Object.keys(props);
  if (names.length === 0) return [];
  const given = params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : {};
  const problems: string[] = [];

  const unknown = Object.keys(given).filter(k => !names.includes(k));
  if (unknown.length) problems.push(`${action}: unknown parameter(s) ${unknown.join(', ')} — valid: ${names.join(', ')}`);

  // The SDK records at most 20 keys per call; a longer call may look like it misses one.
  if (Object.keys(given).length < 20) {
    const missing = (schema.input_parameters?.required ?? []).filter(r => given[r] === undefined || given[r] === null || given[r] === '');
    if (missing.length) problems.push(`${action}: missing required ${missing.join(', ')}`);
  }

  for (const [key, value] of Object.entries(given)) {
    const allowed = props[key]?.enum;
    if (!Array.isArray(allowed) || allowed.length === 0 || typeof value !== 'string') continue;
    if (value.includes('dry-run-preview')) continue; // an id another deferred write would create
    if (!allowed.includes(value)) problems.push(`${action}: ${key}="${value}" is not allowed — use one of: ${allowed.join(', ')}`);
  }
  return problems;
}

/** Schema problems across a preview's deferred Composio writes (proxy calls have no schema to check). */
export async function checkDeferredWrites(writes: DeferredWrite[]): Promise<string[]> {
  const calls = writes.filter(w => /^[A-Z][A-Z0-9_]+$/.test(w.action));
  if (calls.length === 0) return [];
  const toolkits = [...new Set((await Promise.all(calls.map(w => toolkitForAction(w.action)))).filter((t): t is string => !!t))];
  if (toolkits.length === 0) return [];
  const schemas = await getComposioActionSchemas(toolkits);
  const problems = calls.flatMap(w => {
    const schema = schemas.get(w.action) as ActionSchema | undefined;
    return schema ? schemaProblems(w.action, w.params, schema) : [];
  });
  return [...new Set(problems)];
}
