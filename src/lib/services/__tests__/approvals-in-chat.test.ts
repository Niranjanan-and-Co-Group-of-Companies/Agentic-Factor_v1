/* eslint-disable @typescript-eslint/no-explicit-any -- a deliberately loose stand-in for the Supabase client */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── A small in-memory stand-in for the Supabase query builder (only what the approval flow uses) ──
type Row = Record<string, any>;
let db: Record<string, Row[]> = {};
let idSeq = 0;

function builder(table: string) {
  const state: { op: 'select' | 'insert' | 'update'; filters: Array<(r: Row) => boolean>; order?: { col: string; asc: boolean }; limit?: number; patch?: Row; inserted?: Row[]; cols?: string; selectAfter: boolean } =
    { op: 'select', filters: [], selectAfter: false };
  const rows = () => (db[table] ??= []);
  const shape = (r: Row) => (state.cols?.includes('permissions:mission_json->permissions') ? { id: r.id, permissions: r.mission_json?.permissions } : r);
  const run = (): Row[] => {
    if (state.op === 'insert') return state.inserted!;
    let out = rows().filter(r => state.filters.every(f => f(r)));
    if (state.op === 'update') { for (const r of out) Object.assign(r, state.patch); return state.selectAfter ? out : []; }
    if (state.order) out = [...out].sort((a, b) => (a[state.order!.col] > b[state.order!.col] ? 1 : -1) * (state.order!.asc ? 1 : -1));
    if (state.limit != null) out = out.slice(0, state.limit);
    return out.map(shape);
  };
  const q: any = {
    select(cols?: string) { if (state.op === 'select') state.cols = cols; else state.selectAfter = true; return q; },
    eq(col: string, val: unknown) { state.filters.push(r => r[col] === val); return q; },
    in(col: string, vals: unknown[]) { state.filters.push(r => vals.includes(r[col])); return q; },
    order(col: string, opts?: { ascending?: boolean }) { state.order = { col, asc: opts?.ascending !== false }; return q; },
    limit(n: number) { state.limit = n; return q; },
    insert(obj: Row | Row[]) {
      state.op = 'insert';
      state.inserted = (Array.isArray(obj) ? obj : [obj]).map(o => ({ id: `id-${++idSeq}`, created_at: new Date(Date.now() + idSeq).toISOString(), ...o }));
      rows().push(...state.inserted);
      return q;
    },
    update(patch: Row) { state.op = 'update'; state.patch = patch; return q; },
    maybeSingle() { return Promise.resolve({ data: run()[0] ?? null, error: null }); },
    single() { const r = run()[0]; return Promise.resolve({ data: r ?? null, error: r ? null : { message: 'no rows' } }); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
  };
  return q;
}
const fake = { from: (t: string) => builder(t), auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@example.com' } } }) } } };

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => fake }));
vi.mock('@/lib/services/oauth-refresher', () => ({ verifyMissionPermissions: async () => [] }));
const sent: unknown[] = [];
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: async (e: unknown) => { sent.push(e); return {}; } } }));

import { processApprovalDecision, applyChatDecision } from '../approvals';
import { decisionText, describeApproval, recordFromRow } from '../approval-records';
import { appName, humanizeAction } from '@/lib/utils/app-name';

const T = 'tenant-1', M = 'mission-1';
function seed(opts: { chat?: boolean; status?: string } = {}) {
  idSeq = 0;
  sent.length = 0;
  db = {
    missions: [{ id: M, tenant_id: T, status: 'active', mission_json: { permissions: [{ type: 'composio_oauth', service: 'gmail' }] } }],
    proposed_actions: [{
      id: 'act-1', tenant_id: T, mission_id: M, agent_id: 'ag-3', agent_role: 'Gmail Link Sender', mission_title: 'Monthly statements',
      action_type: 'conditional_risk_review', status: opts.status ?? 'pending', submitted_at: '2026-10-17T05:00:00Z',
      payload: { output: '{}', pythonCode: 'x', runId: 'run-1' },
      payload_redacted: { actions: ['GMAIL_SEND_EMAIL'], preview: 'Will run:\n• GMAIL_SEND_EMAIL — recipient_email: owner@example.com' },
    }],
    mission_runs: [{ id: 'run-1', tenant_id: T, mission_id: M, status: 'paused', started_at: '2026-10-17T04:59:00Z' }],
    mission_chats: opts.chat === false ? [] : [
      { id: 'chat-old', tenant_id: T, mission_id: M, title: 'Older', updated_at: '2026-10-10T00:00:00Z' },
      { id: 'chat-new', tenant_id: T, mission_id: M, title: 'Latest', updated_at: '2026-10-16T00:00:00Z' },
    ],
    mission_chat_messages: [],
    approval_history: [],
    events: [],
  };
}

describe('processApprovalDecision — every decision is kept in the mission chat', () => {
  beforeEach(() => seed());

  it('approves with a reason, records who and where, saves it to the latest chat and resumes the run', async () => {
    const result = await processApprovalDecision(T, 'act-1', 'approved', M, { reason: 'Looks right', via: 'command_center', decidedBy: 'owner@example.com' });
    expect(result.ok).toBe(true);
    const action = db.proposed_actions[0];
    expect(action.status).toBe('approved');
    expect(action.payload.decision).toMatchObject({ reason: 'Looks right', via: 'command_center', by: 'owner@example.com' });
    expect(action.payload.runId).toBe('run-1'); // the run's own fields are kept

    const saved = db.mission_chat_messages;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ chat_id: 'chat-new', role: 'assistant', action_applied: true });
    expect(saved[0].action_payload).toMatchObject({ type: 'approval_record', decision: 'approved', reason: 'Looks right', via: 'command_center', actions: ['Gmail: send email'] });
    expect(saved[0].content).toContain('Looks right');
    expect(saved[0].content).toContain('in Command Center');
    expect(db.mission_chats.find(c => c.id === 'chat-new')!.updated_at > '2026-10-16T00:00:00Z').toBe(true);

    expect(db.approval_history).toHaveLength(1);
    expect(sent).toHaveLength(1); // the paused run is resumed
  });

  it('rejects with a reason: the run stops with the reason, and the record keeps it', async () => {
    const result = await processApprovalDecision(T, 'act-1', 'rejected', M, { reason: 'Wrong recipient', via: 'mission_chat' });
    expect(result.ok).toBe(true);
    expect(db.mission_runs[0].status).toBe('failed');
    expect(db.mission_runs[0].summary).toContain('Wrong recipient');
    expect(db.missions[0].status).toBe('failed');
    expect(db.mission_chat_messages[0].action_payload).toMatchObject({ decision: 'rejected', reason: 'Wrong recipient' });
    expect(sent).toHaveLength(0);
  });

  it('never decides twice: a second decision reports the first and adds nothing', async () => {
    await processApprovalDecision(T, 'act-1', 'approved', M, { via: 'mission_chat' });
    const again = await processApprovalDecision(T, 'act-1', 'rejected', M, { via: 'command_center' });
    expect(again).toMatchObject({ ok: false, reason: 'already_decided', decision: 'approved' });
    expect(db.proposed_actions[0].status).toBe('approved');
    expect(db.mission_chat_messages).toHaveLength(1);
  });

  it('starts an "Approvals" chat when the mission has none yet', async () => {
    seed({ chat: false });
    await processApprovalDecision(T, 'act-1', 'approved', M, { via: 'command_center' });
    expect(db.mission_chats).toHaveLength(1);
    expect(db.mission_chats[0].title).toBe('Approvals');
    expect(db.mission_chat_messages[0].chat_id).toBe(db.mission_chats[0].id);
  });

  it("only acts on this workspace's own approvals", async () => {
    const other = await processApprovalDecision('someone-else', 'act-1', 'approved', M, {});
    expect(other).toMatchObject({ ok: false, reason: 'not_found' });
    expect(db.proposed_actions[0].status).toBe('pending');
  });
});

describe('applyChatDecision — "yes, send it" in the chat', () => {
  beforeEach(() => seed());

  it('applies the decision to the pending approval with the customer reason', async () => {
    const out = await applyChatDecision(T, M, T, { type: 'approval_decision', decision: 'approved', reason: 'send it' });
    expect(out.handled).toBe(true);
    expect(out.record).toMatchObject({ decision: 'approved', via: 'chat_message', reason: 'send it' });
    expect(db.proposed_actions[0].status).toBe('approved');
  });

  it('ignores other actions, and says so when nothing is waiting', async () => {
    expect(await applyChatDecision(T, M, T, { type: 'run_now' })).toEqual({ handled: false });
    seed({ status: 'approved' });
    const out = await applyChatDecision(T, M, T, { type: 'approval_decision', decision: 'approved' });
    expect(out.note).toMatch(/Nothing is waiting/);
  });
});

describe('approval records and names', () => {
  it('describes a rehearsal check in plain words', () => {
    const a = describeApproval({ id: 'x', mission_id: M, action_type: 'training_review', agent_role: 'Sheets Builder', payload_redacted: { actions: ['GOOGLESHEETS_CREATE_GOOGLE_SHEET1', 'Custom write'] } }, ['googlesheets']);
    expect(a).toMatchObject({ kind: 'rehearsal', agentRole: 'Sheets Builder', actions: ['Google Sheets: create google sheet', 'Custom write'], status: 'pending' });
  });

  it('rebuilds a record from a decided action, and none for a pending one', () => {
    const row = { id: 'x', mission_id: M, status: 'rejected', agent_role: 'A', payload: { decision: { reason: 'no', via: 'mission_chat', at: '2026-10-17T06:00:00Z' } }, payload_redacted: { actions: ['GMAIL_SEND_EMAIL'] } };
    expect(recordFromRow(row)).toMatchObject({ decision: 'rejected', reason: 'no', via: 'mission_chat', decidedAt: '2026-10-17T06:00:00Z' });
    expect(recordFromRow({ ...row, status: 'pending' })).toBeNull();
  });

  it('writes the chat line with reason, who and where', () => {
    const text = decisionText({ type: 'approval_record', actionId: 'x', decision: 'approved', kind: 'rehearsal', agentRole: 'Builder', actions: ['Gmail: send email'], reason: 'fine', via: 'chat_message', decidedBy: 'a@b.co', decidedAt: '2026-10-17T06:00:00Z' });
    expect(text).toContain('Approved the rehearsal preview');
    expect(text).toContain('“fine”');
    expect(text).toContain('by a@b.co by replying in the chat');
  });

  it('names apps and actions without a lookup table', () => {
    expect(appName('googlesheets')).toBe('Google Sheets');
    expect(appName('zoho_books')).toBe('Zoho Books');
    expect(humanizeAction('GMAIL_SEND_EMAIL')).toBe('Gmail: send email');
    expect(humanizeAction('ZOHO_BOOKS_CREATE_PAYMENT', ['zoho', 'zoho_books'])).toBe('Zoho Books: create payment');
  });
});
