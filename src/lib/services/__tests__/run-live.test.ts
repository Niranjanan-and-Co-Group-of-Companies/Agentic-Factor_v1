import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }));

import { appsInScript, deriveAgents, humanizeAction, runMode, shortError, type RunEventRow } from '../run-live';

const AGENTS = [
  { id: 'a1', role: 'Zoho Books Reader', apps: ['zoho_books'] },
  { id: 'a2', role: 'Workbook Builder', apps: ['googlesheets'] },
  { id: 'a3', role: 'Gmail Sender', apps: ['gmail'] },
];
const ev = (event_type: string, entity_id: string, sec: number, extra: Partial<RunEventRow> = {}): RunEventRow =>
  ({ event_type, entity_id, created_at: new Date(Date.UTC(2026, 9, 16, 10, 0, sec)).toISOString(), ...extra });

describe('deriveAgents', () => {
  it('shows finished, working and waiting agents of a running run', () => {
    const agents = deriveAgents({
      agents: AGENTS,
      runStatus: 'running',
      events: [ev('agent.started', 'a1', 0), ev('agent.completed', 'a1', 6), ev('agent.started', 'a2', 7)],
    });
    expect(agents.map(a => a.step)).toEqual(['done', 'working', 'waiting']);
    expect(agents[0].finishedAt).toBeDefined();
  });

  it('shows a repair in progress after a failed attempt, with the next attempt number', () => {
    const [, second] = deriveAgents({
      agents: AGENTS,
      runStatus: 'running',
      events: [
        ev('agent.completed', 'a1', 6),
        ev('agent.started', 'a2', 7),
        ev('agent.attempt_failed', 'a2', 12, { attempt: '1', max_attempts: '3', error: 'Google Sheets rejected the range' }),
      ],
    });
    expect(second).toMatchObject({ step: 'repairing', attempt: 2, maxAttempts: 3, note: 'Google Sheets rejected the range' });
  });

  it('moves on to checking once a later progress marker arrives', () => {
    const [, second] = deriveAgents({
      agents: AGENTS,
      runStatus: 'running',
      events: [
        ev('agent.started', 'a2', 7),
        ev('agent.attempt_failed', 'a2', 12, { attempt: '1' }),
        ev('agent.progress', 'a2', 20, { phase: 'checking' }),
      ],
    });
    expect(second.step).toBe('checking');
  });

  it('marks the agent waiting on an approval', () => {
    const agents = deriveAgents({
      agents: AGENTS, runStatus: 'paused', approvalAgentId: 'a3',
      events: [ev('agent.completed', 'a1', 6), ev('agent.completed', 'a2', 20), ev('agent.started', 'a3', 21)],
    });
    expect(agents.map(a => a.step)).toEqual(['done', 'done', 'approval']);
  });

  it('marks where a failed run stopped and skips the agents it never reached', () => {
    const agents = deriveAgents({
      agents: AGENTS, runStatus: 'failed', runError: 'Agent "Workbook Builder" failed after 3 attempts. The sheet is read-only.',
      events: [ev('agent.completed', 'a1', 6), ev('agent.started', 'a2', 7)],
    });
    expect(agents.map(a => a.step)).toEqual(['done', 'failed', 'skipped']);
    expect(agents[1].note).toBe('The sheet is read-only.');
  });

  it('shows a step that started in a completed run as done — a rehearsal check records no completion', () => {
    const agents = deriveAgents({
      agents: AGENTS, runStatus: 'completed',
      events: [ev('agent.completed', 'a1', 6), ev('agent.started', 'a2', 7), ev('agent.started', 'a3', 30)],
    });
    expect(agents.map(a => a.step)).toEqual(['done', 'done', 'done']);
  });

  it('never shows agents as queued once the run is done (the old card stayed at "queued 0/3")', () => {
    const agents = deriveAgents({
      agents: AGENTS, runStatus: 'completed',
      events: AGENTS.flatMap((a, i) => [ev('agent.started', a.id, i * 10), ev('agent.completed', a.id, i * 10 + 5)]),
    });
    expect(agents.every(a => a.step === 'done')).toBe(true);
  });
});

describe('runMode', () => {
  const run = { started_at: '2026-10-16T10:00:00Z' };
  it('is a rehearsal while rehearsal mode is on', () => {
    expect(runMode(run, { training_enabled: true })).toBe('rehearsal');
  });
  it('is live for missions that never rehearsed', () => {
    expect(runMode(run, { training_enabled: false, training_graduated_at: null })).toBe('live');
  });
  it('keeps the rehearsal label on the run that passed it, and live after', () => {
    const mission = { training_enabled: false, training_graduated_at: '2026-10-16T10:01:00Z' };
    expect(runMode(run, mission)).toBe('rehearsal');
    expect(runMode({ started_at: '2026-10-16T11:00:00Z' }, mission)).toBe('live');
  });
  it('trusts a rehearsal summary', () => {
    expect(runMode({ started_at: '2026-10-16T12:00:00Z', summary: 'TRAINING REHEARSAL — nothing was sent.' }, { training_enabled: false })).toBe('rehearsal');
  });
});

describe('appsInScript', () => {
  it('maps actions to the longest matching toolkit and keeps proxied ones', () => {
    const script = `composio_execute("ZOHO_BOOKS_LIST_INVOICES", {})\ncomposio_execute("GOOGLESHEETS_BATCH_UPDATE", {})\ncomposio_proxy("notion", "GET", "/v1/pages")`;
    expect(appsInScript(script, ['zoho', 'zoho_books', 'googlesheets', 'gmail'])).toEqual(['zoho_books', 'googlesheets', 'notion']);
  });
  it('returns nothing for a script that calls no apps', () => {
    expect(appsInScript('print("hello")', ['gmail'])).toEqual([]);
  });
});

describe('humanizeAction and shortError', () => {
  it('reads an action slug as app and verb', () => {
    expect(humanizeAction('GMAIL_SEND_EMAIL', ['gmail'])).toBe('Gmail: send email');
    expect(humanizeAction('ZOHO_BOOKS_CREATE_PAYMENT', ['zoho_books'])).toBe('Zoho Books: create payment');
  });
  it('drops the "failed after N attempts" prefix and trims long errors', () => {
    expect(shortError('Agent "X" failed after 3 attempts. Quota exceeded.')).toBe('Quota exceeded.');
    expect(shortError('x'.repeat(400))!.length).toBeLessThanOrEqual(220);
    expect(shortError(null)).toBeUndefined();
  });
});
