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

/** The agents the editor asked to rewrite, with their change notes (read from the raw output — the schema drops scriptChange). */
export function collectRewrites(rawAgents: unknown, agents: Array<{ agentIndex: number; pythonScript?: string }>): ScriptRewrite[] {
  const raw = Array.isArray(rawAgents) ? rawAgents as Array<Record<string, unknown>> : [];
  return agents.flatMap((agent, i) => {
    if (agent.pythonScript?.trim() !== REWRITE_SCRIPT) return [];
    const note = raw.find(r => r?.agentIndex === agent.agentIndex)?.scriptChange ?? raw[i]?.scriptChange;
    return [{ agentIndex: agent.agentIndex, scriptChange: typeof note === 'string' && note.trim() ? note.trim() : 'Apply the change instruction to this agent.' }];
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
