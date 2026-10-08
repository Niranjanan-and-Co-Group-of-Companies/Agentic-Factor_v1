// Deterministic check of composio_execute("ACTION", {...}) calls against Composio's action schemas.
// Composio silently ignores unknown parameters (e.g. 'markdown' instead of 'markdown_text' created an
// empty Google Doc that the script reported as published), so these must be caught before running.

export interface ActionSchema {
  input_parameters?: { properties?: Record<string, unknown>; required?: string[] };
}

export interface ComposioCall {
  action: string;
  keys: string[] | null; // null when params aren't a plain dict literal (variable, **spread, etc.)
}

function skipString(code: string, i: number): number {
  const triple = code.slice(i, i + 3);
  if (triple === '"""' || triple === "'''") {
    const end = code.indexOf(triple, i + 3);
    return end === -1 ? code.length : end + 3;
  }
  const quote = code[i];
  let j = i + 1;
  while (j < code.length && code[j] !== quote && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
  return j + 1;
}

/** Top-level keys of the dict literal starting at code[open] === '{'; null if not a plain literal. */
function dictLiteralKeys(code: string, open: number): string[] | null {
  const keys: string[] = [];
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const ch = code[i];
    if ((ch === '"' || ch === "'") && !/[A-Za-z0-9_]/.test(code[i - 1] ?? '')) {
      const end = skipString(code, i);
      if (depth === 1 && /^\s*:/.test(code.slice(end, end + 20))) keys.push(code.slice(i + 1, end - 1));
      i = end;
      continue;
    }
    if (ch === '#') { const nl = code.indexOf('\n', i); i = nl === -1 ? code.length : nl; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') { depth--; if (depth === 0) return keys; }
    else if (depth === 1 && code.startsWith('**', i)) return null;
    i++;
  }
  return null;
}

export function findComposioCalls(code: string): ComposioCall[] {
  const calls: ComposioCall[] = [];
  const re = /composio_execute\s*\(\s*["']([A-Z][A-Z0-9_]{3,})["']\s*,\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const next = re.lastIndex;
    calls.push({ action: m[1], keys: code[next] === '{' ? dictLiteralKeys(code, next) : null });
  }
  return calls;
}

/** Human-readable problems for the retry fixer; empty when every checkable call matches its schema. */
export function checkComposioParams(code: string, schemas: Map<string, ActionSchema>): string[] {
  const problems: string[] = [];
  for (const call of findComposioCalls(code)) {
    const schema = schemas.get(call.action);
    if (!schema || call.keys === null) continue;
    const props = Object.keys(schema.input_parameters?.properties ?? {});
    if (props.length === 0) continue;
    const unknown = call.keys.filter(k => !props.includes(k));
    const missing = (schema.input_parameters?.required ?? []).filter(r => !call.keys!.includes(r));
    if (unknown.length || missing.length) {
      problems.push(
        `${call.action}: ` +
        (unknown.length ? `unknown parameter(s) ${unknown.map(k => `'${k}'`).join(', ')} (Composio ignores them silently). ` : '') +
        (missing.length ? `missing required ${missing.map(k => `'${k}'`).join(', ')}. ` : '') +
        `Valid parameters: ${props.join(', ')}.`,
      );
    }
  }
  return [...new Set(problems)];
}
