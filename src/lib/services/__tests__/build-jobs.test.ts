/* eslint-disable @typescript-eslint/no-explicit-any -- a deliberately loose stand-in for the Supabase client */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildFailureMessage, buildThread, jobRequest, moveBuildThread, reportBuildFailure, type ThreadMessage } from '../build-jobs';

// ── Minimal in-memory Supabase stand-in ──
type Row = Record<string, any>;
let db: Record<string, Row[]> = {};
let seq = 0;
function from(table: string) {
  const st: { op: 'select' | 'insert' | 'update' | 'delete'; filters: Array<(r: Row) => boolean>; patch?: Row; inserted?: Row[]; limit?: number; order?: { col: string; asc: boolean } } = { op: 'select', filters: [] };
  const rows = () => (db[table] ??= []);
  const pick = (r: Row, path: string) => {
    const [col, key] = path.split(/->>?/);
    return key ? r[col]?.[key] : r[col];
  };
  const run = () => {
    if (st.op === 'insert') return st.inserted!;
    let out = rows().filter(r => st.filters.every(f => f(r)));
    if (st.op === 'update') { out.forEach(r => Object.assign(r, st.patch)); return out; }
    if (st.op === 'delete') { db[table] = rows().filter(r => !out.includes(r)); return out; }
    if (st.order) {
      const { col, asc } = st.order;
      out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    return st.limit != null ? out.slice(0, st.limit) : out;
  };
  const q: any = {
    select() { return q; },
    eq(col: string, v: unknown) { st.filters.push(r => pick(r, col) === v); return q; },
    lte(col: string, v: string) { st.filters.push(r => pick(r, col) <= v); return q; },
    not(col: string) { st.filters.push(r => pick(r, col) != null); return q; }, // only .not(col, 'is', null) is used
    order(col: string, opts?: { ascending?: boolean }) { st.order = { col, asc: opts?.ascending ?? true }; return q; },
    limit(n: number) { st.limit = n; return q; },
    insert(o: Row | Row[]) {
      st.op = 'insert';
      st.inserted = (Array.isArray(o) ? o : [o]).map(r => ({ id: `id-${++seq}`, created_at: `2026-10-17T10:00:${String(seq).padStart(2, '0')}Z`, ...r }));
      rows().push(...st.inserted);
      return q;
    },
    update(p: Row) { st.op = 'update'; st.patch = p; return q; },
    delete() { st.op = 'delete'; return q; },
    maybeSingle() { return Promise.resolve({ data: run()[0] ?? null, error: null }); },
    single() { const r = run()[0]; return Promise.resolve({ data: r ?? null, error: r ? null : { message: 'none' } }); },
    then(res: any, rej: any) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
  };
  return q;
}
const supabase = { from } as any;

const msg = (id: string, role: string, minute: number, content: string, action_payload: Row | null = null): ThreadMessage =>
  ({ id, role, content, action_payload, created_at: `2026-10-17T09:${String(minute).padStart(2, '0')}:00.000Z` });

beforeEach(() => { seq = 0; db = {}; });

describe('buildFailureMessage — the real reason, in words to act on', () => {
  it('names the step that ran out of time', () => {
    expect(buildFailureMessage('FUNCTION_INVOCATION_TIMEOUT', '✍️ Writing code for Canva Designer…'))
      .toBe('Building stopped while writing code for Canva Designer: that step ran out of time. Try again — if it stops again, split the request into two smaller missions.');
    expect(buildFailureMessage('Task timed out after 300 seconds')).toMatch(/^Building stopped: that step ran out of time/);
  });
  it('explains an incomplete design and keeps other reasons as they are', () => {
    expect(buildFailureMessage('[{"code": "invalid_type", "path": [ "agents" ]}]', undefined, 'ZodError'))
      .toBe('The mission design came back incomplete (missing: agents). Please try again.');
    expect(buildFailureMessage('Could not write the code for "Slide Builder".')).toBe('Could not write the code for "Slide Builder".');
    expect(buildFailureMessage('')).toMatch(/without saying why/);
  });
});

describe('buildThread — the conversation that led to a build', () => {
  it('keeps the request, the architect’s question and the answer, and stops at an earlier task', () => {
    const messages = [
      msg('a', 'user', 1, 'How many credits do I have?'),
      msg('b', 'assistant', 2, 'You have 420 credits.', { type: 'show_usage' }),
      msg('c', 'user', 3, 'Make a pitch deck in Canva from my notes'),
      msg('d', 'assistant', 4, 'Building it… **one question**: how many slides?', { type: 'blueprint_question', question: 'How many slides?' }),
      msg('e', 'user', 5, '10 slides'),
      msg('f', 'assistant', 6, 'Building your mission now.', { type: 'building_blueprint', jobId: 'J' }),
    ];
    expect(buildThread(messages).map(m => m.id)).toEqual(['c', 'd', 'e', 'f']);
  });
  it('stops at a long pause and starts with the customer', () => {
    const messages = [
      msg('a', 'user', 1, 'Old question'),
      msg('b', 'assistant', 2, 'Old answer'),
      { ...msg('c', 'assistant', 0, 'Hello again'), created_at: '2026-10-17T12:00:00.000Z' },
      { ...msg('d', 'user', 0, 'Build an invoice reminder'), created_at: '2026-10-17T12:01:00.000Z' },
      { ...msg('e', 'assistant', 0, 'On it.', { type: 'building_blueprint', jobId: 'J' }), created_at: '2026-10-17T12:02:00.000Z' },
    ];
    expect(buildThread(messages).map(m => m.id)).toEqual(['d', 'e']);
  });
});

describe('moving the build conversation into the mission chat', () => {
  beforeEach(() => {
    db.mission_chat_messages = [
      { ...msg('x', 'user', 1, 'Show my missions'), chat_id: 'CC', tenant_id: 'T' },
      { ...msg('y', 'assistant', 2, 'Here they are.', { type: 'show_missions' }), chat_id: 'CC', tenant_id: 'T' },
      { ...msg('c', 'user', 3, 'Send me a daily sales digest'), chat_id: 'CC', tenant_id: 'T' },
      { ...msg('f', 'assistant', 4, 'Building your mission now.', { type: 'building_blueprint', jobId: 'J' }), chat_id: 'CC', tenant_id: 'T' },
    ];
    db.mission_chats = [];
  });

  it('copies the thread between a header and a closing note, as plain messages', async () => {
    const chatId = await moveBuildThread(supabase, 'T', 'J', { id: 'M', title: 'Daily Sales Digest', agentCount: 2 });
    expect(chatId).toBeTruthy();
    expect(db.mission_chats[0]).toMatchObject({ id: chatId, mission_id: 'M', tenant_id: 'T', title: 'Mission setup' });
    const copied = db.mission_chat_messages.filter(m => m.chat_id === chatId).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    expect(copied.map(m => m.content)).toEqual([
      expect.stringMatching(/^Started in Command Center · /),
      'Send me a daily sales digest',
      'Building your mission now.',
      expect.stringMatching(/^✅ Mission created: Daily Sales Digest \(2 agents\)/),
    ]);
    expect(copied[0].action_payload).toMatchObject({ type: 'thread_note', kind: 'started' });
    expect(copied[1].action_payload).toBeNull();
    expect(copied[2].action_payload).toBeNull();
    expect(copied[3].action_payload).toMatchObject({ type: 'thread_note', kind: 'created', missionId: 'M' });
    // The Command Center conversation itself is left as it was.
    expect(db.mission_chat_messages.filter(m => m.chat_id === 'CC')).toHaveLength(4);
  });

  it('does nothing when the build message is not found', async () => {
    expect(await moveBuildThread(supabase, 'T', 'other-job', { id: 'M', title: 'x', agentCount: 1 })).toBeNull();
    expect(db.mission_chats).toHaveLength(0);
  });
});

describe('failed builds and trying again', () => {
  it('reports a failure once, on the job and on its Command Center message (keeping the job for a retry)', async () => {
    db.events = [{ id: 'e1', tenant_id: 'T', event_type: 'blueprint.job_update', entity_id: 'J', created_at: '2026-10-17T09:00:00Z', payload: { status: 'processing', step: '✍️ Writing code for Deck Builder…' } }];
    db.mission_chat_messages = [{ id: 'm1', tenant_id: 'T', chat_id: 'CC', role: 'assistant', action_payload: { type: 'building_blueprint', jobId: 'J' } }];
    const error = await reportBuildFailure(supabase, 'T', 'J', 'Gateway Timeout (504)');
    expect(error).toMatch(/^Building stopped while writing code for Deck Builder/);
    expect(db.mission_chat_messages[0].action_payload).toEqual({ type: 'mission_create_error', error, jobId: 'J' });
    // The platform's own failure report afterwards changes nothing.
    expect(await reportBuildFailure(supabase, 'T', 'J', 'Function failed')).toBe(error);
    expect(db.events.filter(e => e.payload.status === 'failed')).toHaveLength(1);
  });

  it('finds the request a job was started with', async () => {
    db.events = [
      { tenant_id: 'T', event_type: 'blueprint.job_update', entity_id: 'J', created_at: '2026-10-17T09:00:00Z', payload: { status: 'pending', request: { intent: 'Daily digest', priorQuestions: [] } } },
      { tenant_id: 'T', event_type: 'blueprint.job_update', entity_id: 'J', created_at: '2026-10-17T09:01:00Z', payload: { status: 'failed', error: 'x' } },
    ];
    expect(await jobRequest(supabase, 'T', 'J')).toEqual({ intent: 'Daily digest', priorQuestions: [] });
    expect(await jobRequest(supabase, 'T', 'other')).toBeNull();
  });
});
