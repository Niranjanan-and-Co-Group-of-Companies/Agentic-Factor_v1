/**
 * Blueprint edits only touch the agents the customer asked about. The editor model used to
 * re-type every agent's full script (5 agents × ~14K chars) and the validation passes re-typed
 * them all again, so a one-agent change ran past the 300s function limit and nothing was saved.
 * Now the editor writes UNCHANGED_SCRIPT for scripts it leaves alone and we restore the original.
 */

export const UNCHANGED_SCRIPT = '__UNCHANGED__';
/** Marks an agent whose script is rewritten in its own call, from the editor's scriptChange note. */
export const REWRITE_SCRIPT = '__REWRITE__';

export interface ScriptRewrite { agentIndex: number; scriptChange: string }

/**
 * The agents whose script is written in its own call, with what it must do: the editor's scriptChange
 * or a new design's scriptPlan (read from the raw output — the schema drops both), else `fallback`.
 */
export function collectRewrites<A extends { agentIndex: number; pythonScript?: string }>(
  rawAgents: unknown,
  agents: A[],
  fallback: (agent: A) => string = () => 'Apply the change instruction to this agent.',
): ScriptRewrite[] {
  const raw = Array.isArray(rawAgents) ? rawAgents as Array<Record<string, unknown>> : [];
  const noteOf = (r: Record<string, unknown> | undefined) => r?.scriptChange ?? r?.scriptPlan;
  return agents.flatMap((agent, i) => {
    if (agent.pythonScript?.trim() !== REWRITE_SCRIPT) return [];
    const note = noteOf(raw.find(r => r?.agentIndex === agent.agentIndex)) ?? noteOf(raw[i]);
    return [{ agentIndex: agent.agentIndex, scriptChange: typeof note === 'string' && note.trim() ? note.trim() : fallback(agent) }];
  });
}

interface EditedAgent { id?: string; role: string; agentIndex: number; pythonScript?: string; [k: string]: unknown }
interface ExistingAgent { id: string; role: string; agentIndex: number; pythonScript?: string; pythonScriptDraft?: unknown }

function findExisting(agent: EditedAgent, existing: ExistingAgent[]): ExistingAgent | undefined {
  return (agent.id ? existing.find(e => e.id === agent.id) : undefined)
    ?? existing.find(e => e.role === agent.role)
    ?? existing.find(e => e.agentIndex === agent.agentIndex);
}

/**
 * Puts the original script back wherever the editor wrote UNCHANGED_SCRIPT (keeping that
 * agent's self-healed draft, which is tied to the same script). Returns the agentIndex of
 * every agent whose script is new or changed — only those need validating.
 */
export function restoreUnchangedScripts(agents: EditedAgent[], existing: ExistingAgent[]): Set<number> {
  const changed = new Set<number>();
  for (const agent of agents) {
    const before = findExisting(agent, existing);
    if (agent.pythonScript?.trim() === UNCHANGED_SCRIPT) {
      if (before?.pythonScript) {
        agent.pythonScript = before.pythonScript;
        if (before.pythonScriptDraft) agent.pythonScriptDraft = before.pythonScriptDraft;
      } else {
        delete agent.pythonScript;
      }
      continue;
    }
    if (agent.pythonScript && agent.pythonScript !== before?.pythonScript) changed.add(agent.agentIndex);
  }
  return changed;
}
