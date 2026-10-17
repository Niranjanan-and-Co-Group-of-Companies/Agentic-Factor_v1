// What a mission run costs: every model call, the code sandbox by the second, and the web searches and
// app actions its scripts make — each billed at real cost × 4 as it happens and tagged with the run, so
// the run card can show its total and a failed run is settled at the failure rate (1.75×).

import { sandboxCostUsd, toolCostUsd, type ToolUsage } from './prices';

export interface RunBill {
  tenantId: string;
  runId?: string;
  missionId?: string;
  agentRole: string;
  /** Free-plan rehearsals are billed at half. */
  halve?: boolean;
}

/** Run in the sandbox after a script: prints what the script used of the platform's paid services. */
export const USAGE_PROBE = `import json
try:
    from agenticfactor import _core as _af_core
    print("__AF_USAGE__" + json.dumps(getattr(_af_core, "_USAGE", {})))
except Exception:
    print("__AF_USAGE__{}")`;

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The usage the probe printed (zeros when it printed nothing usable). */
export function parseUsageProbe(stdout: string): ToolUsage {
  const line = stdout.split('\n').reverse().find(l => l.startsWith('__AF_USAGE__'));
  if (!line) return {};
  try {
    const u = JSON.parse(line.slice('__AF_USAGE__'.length)) as Record<string, unknown>;
    return { composioCalls: count(u.composioCalls), tavilyCredits: count(u.tavilyCredits), serpapiSearches: count(u.serpapiSearches) };
  } catch {
    return {};
  }
}

async function charge(bill: RunBill, label: string, realCostUsd: number, meta: { provider: string; model?: string; inputTokens?: number; outputTokens?: number; cacheWriteTokens?: number; cacheReadTokens?: number }): Promise<number> {
  const { creditsForCost, deductCredits } = await import('@/lib/middleware/billing');
  const full = await creditsForCost(realCostUsd, 'work');
  const credits = bill.halve ? Math.ceil(full / 2) : full;
  // "<what>:<agent role>" — the run page attributes charges to a mission's agents by this suffix.
  await deductCredits(bill.tenantId, credits, `${label}:${bill.agentRole}`, {
    ...meta, realCostUsd, markup: 'work', runId: bill.runId, missionId: bill.missionId,
  });
  return credits;
}

/** Charges one model call made for an agent (writing, fixing or checking its code; routing). */
export async function chargeModelCall(
  bill: RunBill,
  label: string,
  call: { provider: string; model: string; inputTokens?: number; outputTokens?: number; cacheWriteTokens?: number; cacheReadTokens?: number },
): Promise<number> {
  const { calculateRealCostUsd } = await import('@/lib/middleware/billing');
  const realCostUsd = calculateRealCostUsd(call.model, call.inputTokens ?? 0, call.outputTokens ?? 0, call);
  return charge(bill, label, realCostUsd, call);
}

/** Charges a sandbox for the seconds it was alive and the searches and app actions its script made. */
export async function chargeSandbox(bill: RunBill, label: string, seconds: number, tools: ToolUsage = {}): Promise<number> {
  const realCostUsd = sandboxCostUsd(seconds) + toolCostUsd(tools);
  const parts = [`${Math.round(seconds)}s sandbox`];
  if (tools.composioCalls) parts.push(`${tools.composioCalls} app action${tools.composioCalls === 1 ? '' : 's'}`);
  const searches = (tools.tavilyCredits ?? 0) + (tools.serpapiSearches ?? 0);
  if (searches) parts.push(`${searches} search credit${searches === 1 ? '' : 's'}`);
  return charge(bill, label, realCostUsd, { provider: 'e2b', model: parts.join(' · ') });
}
