/* eslint-disable @typescript-eslint/no-explicit-any -- a deliberately loose stand-in for the Supabase client */
import { describe, it, expect, beforeEach } from 'vitest';
import { entryText, recordRunCard, resultTitle, saveToMissionChat, validateEntry } from '../chat-log';

// ── Minimal in-memory Supabase stand-in (select / eq / order / limit / insert / update) ──
type Row = Record<string, any>;
let db: Record<string, Row[]> = {};
let seq = 0;
function from(table: string) {
  const st: { op: 'select' | 'insert' | 'update'; filters: Array<(r: Row) => boolean>; patch?: Row; inserted?: Row[]; limit?: number; order?: string } = { op: 'select', filters: [] };
  const rows = () => (db[table] ??= []);
  const pick = (r: Row, path: string) => path.includes('->>') ? r[path.split('->>')[0]]?.[path.split('->>')[1]] : r[path];
  const run = () => {
    if (st.op === 'insert') return st.inserted!;
    let out = rows().filter(r => st.filters.every(f => f(r)));
    if (st.op === 'update') { out.forEach(r => Object.assign(r, st.patch)); return out; }
    if (st.order) out = [...out].sort((a, b) => (a[st.order!] < b[st.order!] ? 1 : -1));
    return st.limit != null ? out.slice(0, st.limit) : out;
  };
  const q: any = {
    select() { return q; },
    eq(col: string, v: unknown) { st.filters.push(r => pick(r, col) === v); return q; },
    order(col: string) { st.order = col; return q; },
    limit(n: number) { st.limit = n; return q; },
    insert(o: Row) { st.op = 'insert'; st.inserted = [{ id: `id-${++seq}`, updated_at: `2026-10-17T00:00:${String(seq).padStart(2, '0')}Z`, ...o }]; rows().push(...st.inserted); return q; },
    update(p: Row) { st.op = 'update'; st.patch = p; return q; },
    maybeSingle() { return Promise.resolve({ data: run()[0] ?? null, error: null }); },
    single() { const r = run()[0]; return Promise.resolve({ data: r ?? null, error: r ? null : { message: 'none' } }); },
    then(res: any, rej: any) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
  };
  return q;
}
const supabase = { from } as any;

beforeEach(() => {
  seq = 0;
  db = {
    mission_chats: [
      { id: 'c-old', tenant_id: 'T', mission_id: 'M', updated_at: '2026-10-01T00:00:00Z' },
      { id: 'c-new', tenant_id: 'T', mission_id: 'M', updated_at: '2026-10-16T00:00:00Z' },
    ],
    mission_chat_messages: [],
  };
});

describe('validateEntry — only known shapes are stored', () => {
  it('accepts an action result and stamps the time; never trusts client text', () => {
    const e = validateEntry({ type: 'action_result', kind: 'schedule', ok: true, label: 'Every Monday 9am', detail: 'Next run Mon', content: 'ignored' });
    expect(e).toMatchObject({ type: 'action_result', kind: 'schedule', ok: true, label: 'Every Monday 9am', detail: 'Next run Mon', via: 'mission_chat' });
    expect(e && 'content' in e).toBe(false);
    expect(typeof (e as { at: string }).at).toBe('string');
  });
  it('rejects unknown kinds, missing labels and other types', () => {
    expect(validateEntry({ type: 'action_result', kind: 'delete_everything', ok: true, label: 'x' })).toBeNull();
    expect(validateEntry({ type: 'action_result', kind: 'pause', ok: true })).toBeNull();
    expect(validateEntry({ type: 'approval_record', actionId: 'a' })).toBeNull();
    expect(validateEntry(null)).toBeNull();
  });
  it('accepts a run card only with a run and a mission', () => {
    expect(validateEntry({ type: 'run_card', runId: 'r1', missionId: 'M', runNumber: 3 })).toMatchObject({ runId: 'r1', missionId: 'M', runNumber: 3 });
    expect(validateEntry({ type: 'run_card', runId: 'r1' })).toBeNull();
  });
});

describe('entryText — what the history (and the assistant) reads', () => {
  it('describes results and failures with their reason', () => {
    expect(entryText({ type: 'action_result', kind: 'schedule', ok: true, label: 'Every Monday 9am', detail: 'Next run Mon 20 Oct', at: 'x' }))
      .toBe('✅ Schedule set: Every Monday 9am — Next run Mon 20 Oct.');
    expect(entryText({ type: 'action_result', kind: 'go_live', ok: false, label: 'Live runs', error: 'Not allowed', at: 'x' }))
      .toBe('⚠️ Couldn’t switch to live: Live runs — Reason: Not allowed.');
    expect(resultTitle({ kind: 'connect', ok: true })).toBe('Connected');
  });
  it('describes run cards', () => {
    expect(entryText({ type: 'run_card', runId: 'r', missionId: 'M', runNumber: 4, trigger: 'schedule' })).toBe('▶ Run #4 started (schedule).');
  });
});

describe('saving into the mission chat', () => {
  it('goes into the most recent chat and moves it to the top', async () => {
    await saveToMissionChat(supabase, 'T', 'M', { type: 'action_result', kind: 'pause', ok: true, label: 'Mission', at: 'x' });
    expect(db.mission_chat_messages).toHaveLength(1);
    expect(db.mission_chat_messages[0]).toMatchObject({ chat_id: 'c-new', action_applied: true, action_payload: { kind: 'pause' } });
  });
  it('starts a "Mission activity" chat when there is none', async () => {
    db.mission_chats = [];
    await saveToMissionChat(supabase, 'T', 'M', { type: 'run_card', runId: 'r', missionId: 'M' });
    expect(db.mission_chats[0]).toMatchObject({ title: 'Mission activity', mission_id: 'M' });
  });
  it('records a run card once, however often the run resumes', async () => {
    const card = { type: 'run_card' as const, runId: 'run-9', missionId: 'M', runNumber: 9 };
    await recordRunCard(supabase, 'T', card);
    await recordRunCard(supabase, 'T', card);
    expect(db.mission_chat_messages.filter(m => m.action_payload.runId === 'run-9')).toHaveLength(1);
  });
});
