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

import { actionsNamedIn, collectRewrites, REWRITE_SCRIPT, scriptFrom } from '../blueprint-edit';

describe('collectRewrites', () => {
  it('lists the agents marked for rewrite with their change notes', () => {
    const raw = [
      { agentIndex: 0, pythonScript: UNCHANGED_SCRIPT },
      { agentIndex: 1, pythonScript: REWRITE_SCRIPT, scriptChange: 'Look contacts up by name before creating them.' },
      { agentIndex: 2, pythonScript: REWRITE_SCRIPT },
    ];
    const agents = [
      { agentIndex: 0, pythonScript: 'kept' },
      { agentIndex: 1, pythonScript: REWRITE_SCRIPT },
      { agentIndex: 2, pythonScript: ` ${REWRITE_SCRIPT} ` },
    ];
    expect(collectRewrites(raw, agents)).toEqual([
      { agentIndex: 1, scriptChange: 'Look contacts up by name before creating them.' },
      { agentIndex: 2, scriptChange: 'Apply the change instruction to this agent.' },
    ]);
    expect(collectRewrites(undefined, [{ agentIndex: 0, pythonScript: 'x' }])).toEqual([]);
  });
  it("reads a new design's scriptPlan, and falls back to what the agent itself says", () => {
    const raw = [
      { agentIndex: 0, pythonScript: REWRITE_SCRIPT, scriptPlan: 'Call GMAIL_FETCH_EMAILS for the last 24h; print {"emails": [...]}' },
      { agentIndex: 1, pythonScript: REWRITE_SCRIPT },
    ];
    const agents = [
      { agentIndex: 0, pythonScript: REWRITE_SCRIPT, systemPrompt: 'Reads mail' },
      { agentIndex: 1, pythonScript: REWRITE_SCRIPT, systemPrompt: 'Summarises the emails' },
    ];
    expect(collectRewrites(raw, agents, a => a.systemPrompt)).toEqual([
      { agentIndex: 0, scriptChange: 'Call GMAIL_FETCH_EMAILS for the last 24h; print {"emails": [...]}' },
      { agentIndex: 1, scriptChange: 'Summarises the emails' },
    ]);
  });
});

describe('scriptFrom — the script in a writer\'s reply', () => {
  it('reads the JSON field, a similar key, or the longest python block', () => {
    expect(scriptFrom('{"pythonScript": "print(1)"}')).toEqual({ script: 'print(1)', why: '' });
    expect(scriptFrom('{"python_script": "print(2)"}').script).toBe('print(2)');
    expect(scriptFrom('Here it is:\n```python\nimport json\nprint(json.dumps({}))\n```').script).toBe('import json\nprint(json.dumps({}))\n');
  });
  it('says why when there is none', () => {
    expect(scriptFrom(`{"pythonScript": "${REWRITE_SCRIPT}"}`)).toEqual({ why: 'the reply had no script in it' });
    expect(scriptFrom('Sorry, I cannot do that.').why).toBe('the reply was not valid JSON');
    expect(scriptFrom('  ').why).toBe('the reply was empty');
  });
});

describe('actionsNamedIn — the Composio actions a plan spells out', () => {
  it('keeps the actions of the toolkits in play and ignores other capitals', () => {
    const plan = 'Read input_data["commits"] (from GITHUB_LIST_COMMITS) and post with SLACK_SEND_MESSAGE to the channel. Use ZOHO_BOOKS_LIST_INVOICES only if asked. Output JSON_FIELD.';
    expect(actionsNamedIn(plan, ['slack', 'zoho_books'])).toEqual(['SLACK_SEND_MESSAGE', 'ZOHO_BOOKS_LIST_INVOICES']);
    expect(actionsNamedIn('Write a summary with ask_ai.', ['slack'])).toEqual([]);
  });
});
