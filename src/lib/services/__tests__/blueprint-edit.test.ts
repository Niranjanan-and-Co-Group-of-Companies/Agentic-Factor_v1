import { describe, it, expect } from 'vitest';
import { restoreUnchangedScripts, UNCHANGED_SCRIPT } from '../blueprint-edit';

const existing = [
  { id: 'a0', role: 'GitHub Collector', agentIndex: 0, pythonScript: 'old github', pythonScriptDraft: { code: 'healed github', basedOn: 'h0' } },
  { id: 'a1', role: 'Doc Writer', agentIndex: 1, pythonScript: 'old doc' },
];

describe('restoreUnchangedScripts', () => {
  it('restores untouched scripts and their drafts, and reports only the changed agent', () => {
    const agents: Array<Record<string, any>> = [
      { id: 'a0', role: 'GitHub Collector', agentIndex: 0, pythonScript: UNCHANGED_SCRIPT },
      { id: 'a1', role: 'Doc Writer', agentIndex: 1, pythonScript: 'new doc' },
    ];
    const changed = restoreUnchangedScripts(agents as any, existing);
    expect(agents[0].pythonScript).toBe('old github');
    expect(agents[0].pythonScriptDraft).toEqual({ code: 'healed github', basedOn: 'h0' });
    expect(agents[1].pythonScript).toBe('new doc');
    expect([...changed]).toEqual([1]);
  });

  it('matches by id before position, so inserting an agent does not shuffle scripts', () => {
    const agents: Array<Record<string, any>> = [
      { role: 'New Filter', agentIndex: 0, pythonScript: 'filter code' },
      { id: 'a0', role: 'GitHub Collector', agentIndex: 1, pythonScript: UNCHANGED_SCRIPT },
      { id: 'a1', role: 'Doc Writer', agentIndex: 2, pythonScript: UNCHANGED_SCRIPT },
    ];
    const changed = restoreUnchangedScripts(agents as any, existing);
    expect(agents[1].pythonScript).toBe('old github');
    expect(agents[2].pythonScript).toBe('old doc');
    expect([...changed]).toEqual([0]);
  });

  it('treats a script repeated verbatim as unchanged and drops the marker when there is nothing to restore', () => {
    const agents: Array<Record<string, any>> = [
      { id: 'a0', role: 'GitHub Collector', agentIndex: 0, pythonScript: 'old github' },
      { role: 'Brand New', agentIndex: 1, pythonScript: UNCHANGED_SCRIPT },
    ];
    const changed = restoreUnchangedScripts(agents as any, existing.slice(0, 1));
    expect(changed.size).toBe(0);
    expect(agents[1].pythonScript).toBeUndefined();
  });
});
