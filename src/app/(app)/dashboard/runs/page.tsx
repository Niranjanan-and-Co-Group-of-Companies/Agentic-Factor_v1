'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

interface Run {
  id: string;
  mission_id: string;
  run_number: number;
  status: string;
  trigger_type: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  agents_total: number;
  agents_done: number;
  agents_failed: number;
}

interface Mission {
  id: string;
  title: string;
}

const STATUS_COLOR: Record<string, string> = {
  completed: 'var(--emerald)',
  failed: '#ef4444',
  active: '#f59e0b',
  paused: '#6366f1',
};

function formatDuration(ms: number | null) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function RunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [missionMap, setMissionMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  const loadRuns = useCallback(async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: runsData }, { data: missionsData }] = await Promise.all([
      supabase
        .from('mission_runs')
        .select('id, mission_id, run_number, status, trigger_type, started_at, completed_at, duration_ms, agents_total, agents_done, agents_failed')
        .eq('tenant_id', user.id)
        .order('started_at', { ascending: false })
        .limit(100),
      supabase
        .from('missions')
        .select('id, title')
        .eq('tenant_id', user.id),
    ]);

    const map: Record<string, string> = {};
    for (const m of (missionsData ?? []) as Mission[]) map[m.id] = m.title;
    setMissionMap(map);
    setRuns((runsData ?? []) as Run[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const openRun = (run: Run) => {
    sessionStorage.setItem(`run_mission_${run.id}`, run.mission_id);
    router.push(`/dashboard/runs/${run.id}`);
  };

  const filtered = filter === 'all' ? runs : runs.filter(r => r.status === filter);

  const counts = runs.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="animate-spin" style={{ fontSize: '1.5rem', marginBottom: 12 }}>◌</div>
          <div style={{ fontSize: '0.85rem' }}>Loading run history…</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="page-title">Run History</h1>
            <p className="page-subtitle">{runs.length} run{runs.length !== 1 ? 's' : ''} across all missions</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => router.push('/dashboard')}>← Command Center</button>
            <button className="btn btn-ghost btn-sm" onClick={() => router.push('/dashboard/missions')}>Missions</button>
          </div>
        </div>
      </div>

      {/* Status filter pills */}
      {runs.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {(['all', 'completed', 'failed', 'active'] as const).map(s => {
            const count = s === 'all' ? runs.length : (counts[s] ?? 0);
            if (s !== 'all' && !count) return null;
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: filter === s ? 'var(--accent-subtle)' : 'var(--bg-card)', border: `1px solid ${filter === s ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 20, padding: '5px 12px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: filter === s ? 'var(--accent)' : 'var(--text-secondary)' }}
              >
                {s !== 'all' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[s] ?? 'var(--text-muted)' }} />}
                {count} {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {runs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>📋</div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>No runs yet</h3>
          <p style={{ fontSize: '0.88rem', marginBottom: 24 }}>Runs appear here once you execute a mission.</p>
          <button className="btn btn-primary" onClick={() => router.push('/dashboard/missions')}>Go to Missions →</button>
        </div>
      )}

      {/* Runs table */}
      {filtered.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  {['Run', 'Mission', 'Status', 'Trigger', 'Started', 'Duration', 'Agents'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(run => (
                  <tr
                    key={run.id}
                    onClick={() => openRun(run)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '10px 14px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>#{run.run_number}</td>
                    <td style={{ padding: '10px 14px', maxWidth: 200 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                        {missionMap[run.mission_id] ?? '—'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[run.status] ?? 'var(--text-muted)', flexShrink: 0 }} />
                        <span style={{ color: STATUS_COLOR[run.status] ?? 'var(--text-secondary)', fontWeight: 600 }}>{run.status}</span>
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{run.trigger_type ?? 'manual'}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatDate(run.started_at)}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{formatDuration(run.duration_ms)}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {run.agents_done}/{run.agents_total}
                      {run.agents_failed > 0 && <span style={{ color: '#ef4444', marginLeft: 4 }}>({run.agents_failed} failed)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No filter results */}
      {runs.length > 0 && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          No {filter} runs found. <button onClick={() => setFilter('all')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>Clear filter</button>
        </div>
      )}
    </>
  );
}
