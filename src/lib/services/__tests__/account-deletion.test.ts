/* eslint-disable @typescript-eslint/no-explicit-any -- a deliberately loose stand-in for the Supabase client */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ACCOUNT_TABLES, cancelDeletion, deleteAccount, deletionStatus, dueDeletions, requestDeletion } from '../account-deletion';

// ── In-memory Supabase stand-in: tables, storage and the auth admin API ──
type Row = Record<string, any>;
let db: Record<string, Row[]> = {};
let files: Record<string, string[]> = {};
let deletedUsers: string[] = [];
let clock = 0;

function from(table: string) {
  const st: { op: 'select' | 'insert' | 'update' | 'delete'; filters: Array<(r: Row) => boolean>; patch?: Row; order?: { col: string; asc: boolean }; limit?: number; head?: boolean } = { op: 'select', filters: [] };
  const rows = () => (db[table] ??= []);
  const run = () => {
    let out = rows().filter(r => st.filters.every(f => f(r)));
    if (st.op === 'update') { out.forEach(r => Object.assign(r, st.patch)); return out; }
    if (st.op === 'delete') { db[table] = rows().filter(r => !out.includes(r)); return out; }
    if (st.order) { const { col, asc } = st.order; out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1)); }
    return st.limit != null ? out.slice(0, st.limit) : out;
  };
  const q: any = {
    select(_c?: string, opts?: { head?: boolean }) { st.head = !!opts?.head; return q; },
    insert(o: Row) { rows().push({ ...o, created_at: new Date(Date.UTC(2026, 9, 1) + (clock++) * 1000).toISOString() }); st.op = 'insert'; return q; },
    update(p: Row) { st.op = 'update'; st.patch = p; return q; },
    delete() { st.op = 'delete'; return q; },
    eq(c: string, v: unknown) { st.filters.push(r => r[c] === v); return q; },
    in(c: string, vs: unknown[]) { st.filters.push(r => vs.includes(r[c])); return q; },
    lte(c: string, v: string) { st.filters.push(r => r[c] <= v); return q; },
    order(c: string, o?: { ascending?: boolean }) { st.order = { col: c, asc: o?.ascending ?? true }; return q; },
    limit(n: number) { st.limit = n; return q; },
    maybeSingle() { return Promise.resolve({ data: run()[0] ?? null, error: null }); },
    then(res: any, rej: any) {
      if (st.op === 'insert') return Promise.resolve({ data: null, error: null }).then(res, rej);
      const out = run();
      return Promise.resolve({ data: st.head ? null : out, count: out.length, error: null }).then(res, rej);
    },
  };
  return q;
}
const storage = {
  from: (bucket: string) => ({
    list: async (prefix: string) => {
      const all = (files[bucket] ?? []).filter(p => p.startsWith(`${prefix}/`)).map(p => p.slice(prefix.length + 1));
      const names = [...new Set(all.map(p => p.split('/')[0]))];
      return { data: names.map(n => (all.includes(n) ? { name: n, id: `id-${n}` } : { name: n, id: null })), error: null };
    },
    remove: async (paths: string[]) => { files[bucket] = (files[bucket] ?? []).filter(p => !paths.includes(p)); return { data: null, error: null }; },
  }),
};
const supabase = { from, storage, auth: { admin: { deleteUser: async (id: string) => { deletedUsers.push(id); return { error: null }; } } } } as any;

const T = 'tenant-1';
beforeEach(() => {
  clock = 0;
  deletedUsers = [];
  db = {
    missions: [
      { id: 'm1', tenant_id: T, status: 'active', schedule_paused: false },
      { id: 'm2', tenant_id: T, status: 'draft', schedule_paused: true },
      { id: 'other', tenant_id: 'tenant-2', status: 'active', schedule_paused: false },
    ],
    mission_runs: [{ id: 'r1', tenant_id: T }, { id: 'r2', tenant_id: 'tenant-2' }],
    tenant_billing: [{ tenant_id: T, razorpay_subscription_id: 'sub_1' }],
    team_members: [{ owner_tenant_id: T }, { member_user_id: T, owner_tenant_id: 'tenant-2' }],
    events: [],
  };
  files = { 'mission-artifacts': [`${T}/run1/report.pdf`, `${T}/run1/chart.png`, 'tenant-2/x.pdf'], 'tenant-uploads': [`${T}/platform/a.csv`] };
});

describe('asking to delete, and changing your mind', () => {
  it('stops everything, and keeping the account puts it back as it was', async () => {
    const now = Date.UTC(2026, 9, 20);
    const status = await requestDeletion(supabase, T, 'a@b.c', now);
    expect(status.deleteAfter).toBe(new Date(now + 7 * 86_400_000).toISOString());
    expect(db.missions.find(m => m.id === 'm1')).toMatchObject({ status: 'paused', schedule_paused: true });
    expect(db.missions.find(m => m.id === 'other')).toMatchObject({ status: 'active', schedule_paused: false });
    expect((await deletionStatus(supabase, T)).pending).toBe(true);

    expect(await cancelDeletion(supabase, T)).toBe(true);
    expect((await deletionStatus(supabase, T)).pending).toBe(false);
    expect(db.missions.find(m => m.id === 'm1')).toMatchObject({ status: 'active', schedule_paused: false });
    expect(db.missions.find(m => m.id === 'm2')).toMatchObject({ status: 'draft', schedule_paused: true });
    expect(await cancelDeletion(supabase, T)).toBe(false);
  });

  it('picks up only accounts whose 7 days have passed and that did not cancel', async () => {
    db.events.push(
      { tenant_id: T, event_type: 'account.deletion_requested', created_at: '2026-10-01T00:00:00.000Z', payload: { deleteAfter: '2026-10-08T00:00:00.000Z' } },
      { tenant_id: 'kept', event_type: 'account.deletion_requested', created_at: '2026-10-01T00:00:00.000Z', payload: { deleteAfter: '2026-10-08T00:00:00.000Z' } },
      { tenant_id: 'kept', event_type: 'account.deletion_cancelled', created_at: '2026-10-02T00:00:00.000Z', payload: {} },
      { tenant_id: 'recent', event_type: 'account.deletion_requested', created_at: '2026-10-19T00:00:00.000Z', payload: { deleteAfter: '2026-10-26T00:00:00.000Z' } },
    );
    expect(await dueDeletions(supabase, Date.UTC(2026, 9, 20))).toEqual([T]);
  });
});

describe('deleting an account', () => {
  const deps = () => ({ cancelSubscription: vi.fn(async () => {}), revokeAppConnections: vi.fn(async () => 3) });

  it('a dry run only counts', async () => {
    const d = deps();
    const report = await deleteAccount(supabase, T, d, true);
    expect(report).toMatchObject({ subscription: 'would cancel', appConnections: 3, files: 3, login: 'would delete' });
    expect(report.rows.missions).toBe(2);
    expect(d.cancelSubscription).not.toHaveBeenCalled();
    expect(db.missions).toHaveLength(3);
    expect(deletedUsers).toEqual([]);
  });

  it('removes the subscription, app connections, files, rows and login — and nothing of anyone else', async () => {
    const d = deps();
    const report = await deleteAccount(supabase, T, d);
    expect(d.cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(d.revokeAppConnections).toHaveBeenCalledWith(T, false);
    expect(report.files).toBe(3);
    expect(files['mission-artifacts']).toEqual(['tenant-2/x.pdf']);
    expect(files['tenant-uploads']).toEqual([]);
    expect(db.missions.map(m => m.id)).toEqual(['other']);
    expect(db.mission_runs.map(r => r.id)).toEqual(['r2']);
    expect(db.tenant_billing).toEqual([]);
    expect(db.team_members).toEqual([]);
    expect(deletedUsers).toEqual([T]);
    expect(db.events.filter(e => e.event_type === 'account.deleted')).toHaveLength(1);
  });

  it('stops before deleting anything when the subscription cannot be cancelled', async () => {
    const d = { ...deps(), cancelSubscription: vi.fn(async () => { throw new Error('Razorpay is down'); }) };
    await expect(deleteAccount(supabase, T, d)).rejects.toThrow('Razorpay is down');
    expect(db.missions).toHaveLength(3);
    expect(deletedUsers).toEqual([]);
  });

  it('covers every table with an account column', () => {
    const covered = new Set(ACCOUNT_TABLES.map(t => t.table));
    for (const t of ['missions', 'mission_runs', 'mission_chats', 'mission_chat_messages', 'events', 'tenant_permissions', 'tenant_billing', 'team_members', 'mission_members', 'proposed_actions', 'tenant_memory', 'voice_calls']) {
      expect(covered.has(t)).toBe(true);
    }
  });
});
