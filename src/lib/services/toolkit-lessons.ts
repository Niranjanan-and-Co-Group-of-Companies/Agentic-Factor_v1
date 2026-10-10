/**
 * What the platform learns about each app's API, so a rule is discovered once — not once per agent.
 * A Zoho Books seed re-discovered the same rules in every quarter (bills need a unique bill_number and
 * an account_id on each line; account_type only takes certain values), three or four runs each.
 * When an agent succeeds after API-type failures, a short model call turns the error and the working
 * script into one general rule about that app (no customer data). The architect, the code writer and
 * the fixer get those rules for every app a script uses — across missions and customers.
 */
import { createServiceClient } from '@/lib/supabase/server';
import { callLLM } from './llm-router';
import { robustJSONParse } from '../utils/json-parser';
import { toolkitForAction } from './composio-actions';

const API_ERROR = /HTTP \d{3}|write\(s\) failed|not allowed|required|invalid|cannot be empty|unknown parameter|does not exist|not authorized|validation/i;

/** The Composio toolkits a script calls: composio_execute actions (via Composio) and composio_proxy slugs. */
export async function toolkitsOf(code: string): Promise<string[]> {
  const actions = [...new Set([...code.matchAll(/composio_execute\s*\(\s*["']([A-Z][A-Z0-9_]{3,})["']/g)].map(m => m[1]))];
  const proxied = [...code.matchAll(/composio_proxy\(\s*["']([A-Za-z0-9_]+)["']/g)].map(m => m[1].toLowerCase());
  const resolved = await Promise.all(actions.slice(0, 20).map(a => toolkitForAction(a).catch(() => null)));
  return [...new Set([...resolved.filter((t): t is string => !!t), ...proxied])];
}

/** Known rules for these toolkits, newest first, as a prompt section ('' when none). */
export async function lessonsFor(toolkits: string[], perToolkit = 12): Promise<string> {
  const wanted = [...new Set(toolkits.map(t => t.toLowerCase()))];
  if (wanted.length === 0) return '';
  try {
    const { data } = await createServiceClient().from('events')
      .select('payload').eq('event_type', 'toolkit.lesson')
      .in('payload->>toolkit', wanted)
      .order('created_at', { ascending: false }).limit(300);
    const byToolkit = new Map<string, string[]>();
    for (const row of (data ?? []) as Array<{ payload: { toolkit?: string; lesson?: string } }>) {
      const { toolkit, lesson } = row.payload ?? {};
      if (!toolkit || !lesson) continue;
      const list = byToolkit.get(toolkit) ?? [];
      const key = lesson.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (list.length < perToolkit && !list.some(l => l.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === key)) list.push(lesson);
      byToolkit.set(toolkit, list);
    }
    if (byToolkit.size === 0) return '';
    const sections = [...byToolkit].map(([t, rules]) => `${t}:\n${rules.map(r => `- ${r}`).join('\n')}`);
    return `\n\nKNOWN API RULES (learned from earlier runs — follow them; they override guesses):\n${sections.join('\n')}`;
  } catch {
    return '';
  }
}

/**
 * After an agent succeeds, learns from the API-type failures it had on the way (this run or earlier
 * ones). Bounded and best-effort: never fails the agent.
 */
export async function learnFromFix(opts: {
  tenantId: string; missionId: string; agentId: string; workingCode: string; recentError?: string;
}): Promise<void> {
  const supabase = createServiceClient();
  let error = opts.recentError && API_ERROR.test(opts.recentError) ? opts.recentError : '';
  if (!error) {
    const since = new Date(Date.now() - 48 * 3600_000).toISOString();
    const { data } = await supabase.from('events').select('payload, created_at')
      .eq('event_type', 'agent.attempt_failed').eq('entity_id', opts.agentId).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(5);
    error = ((data ?? []) as Array<{ payload: { error?: string } }>).map(r => r.payload?.error ?? '').find(e => API_ERROR.test(e)) ?? '';
  }
  if (!error) return;

  const toolkits = await toolkitsOf(opts.workingCode);
  if (toolkits.length === 0) return;
  const known = await lessonsFor(toolkits, 30);

  const res = await callLLM([
    {
      role: 'system',
      content: `A script calling these apps' APIs failed with the error below and now works. State what the error teaches about the app's API as general rules for future scripts — e.g. "Zoho Books: POST /bills needs a unique bill_number and an account_id on every line item". Rules about the app only: no customer data (no names, amounts, ids, emails, dates), nothing about Python bugs or this mission's logic. Skip any rule already in the known list. Return JSON {"rules": [{"toolkit": "<one of: ${toolkits.join(', ')}>", "rule": "<one sentence>"}]} — an empty list when there is nothing new.`,
    },
    {
      role: 'user',
      content: `ERROR:\n${error.slice(0, 2500)}\n\nWORKING SCRIPT (excerpt):\n${opts.workingCode.slice(0, 9000)}${known ? `\n\nALREADY KNOWN:${known}` : ''}`,
    },
  ], { jsonMode: true, temperature: 0, tier: 2 });

  const rules = (robustJSONParse(res.content)?.rules ?? []) as Array<{ toolkit?: string; rule?: string }>;
  const rows = rules
    .filter(r => r.toolkit && r.rule && toolkits.includes(r.toolkit.toLowerCase()) && r.rule.length < 400)
    .slice(0, 5)
    .map(r => ({
      tenant_id: opts.tenantId, event_type: 'toolkit.lesson', entity_type: 'agent', entity_id: opts.agentId,
      payload: { toolkit: r.toolkit!.toLowerCase(), lesson: r.rule!.trim(), missionId: opts.missionId, from: error.slice(0, 300) },
    }));
  if (rows.length) await supabase.from('events').insert(rows);
}
