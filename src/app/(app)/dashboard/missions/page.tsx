'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

interface Mission {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface MissionRun {
  id: string;
  mission_id: string;
  run_number: number;
  status: string;
  started_at: string;
  duration_ms: number | null;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--emerald)',
  failed: '#ef4444',
  paused: '#f59e0b',
  draft: 'var(--text-muted)',
  completed: '#6366f1',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  failed: 'Failed',
  paused: 'Paused',
  draft: 'Draft',
  completed: 'Completed',
};

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function formatAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function MissionsPage() {
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [lastRuns, setLastRuns] = useState<Record<string, MissionRun>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  const loadMissions = useCallback(async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('missions')
      .select('id, title, description, status, created_at, updated_at')
      .eq('tenant_id', user.id)
      .order('updated_at', { ascending: false });
    setMissions(data ?? []);

    if (data && data.length > 0) {
      const missionIds = data.map(m => m.id);
      const { data: runs } = await supabase
        .from('mission_runs')
        .select('id, mission_id, run_number, status, started_at, duration_ms')
        .in('mission_id', missionIds)
        .order('started_at', { ascending: false });
      const runMap: Record<string, MissionRun> = {};
      for (const run of runs ?? []) {
        if (!runMap[run.mission_id]) runMap[run.mission_id] = run;
      }
      setLastRuns(runMap);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadMissions(); }, [loadMissions]);

  const handleStart = async (mission: Mission) => {
    setActionLoading(mission.id);
    try {
      const ep = mission.status === 'draft'
        ? `/api/missions/${mission.id}/run`
        : `/api/missions/${mission.id}/execute`;
      const res = await fetch(ep, { method: 'POST', credentials: 'include' });
      if (res.ok) { showToast('🚀 Mission started!'); loadMissions(); }
      else { const e = await res.json() as { error?: string }; showToast(`❌ ${e.error ?? 'Could not start.'}`); }
    } catch { showToast('❌ Connection error.'); }
    setActionLoading(null);
  };

  const handlePause = async (mission: Mission) => {
    setActionLoading(mission.id);
    const res = await fetch(`/api/missions/${mission.id}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });
    if (res.ok) { showToast('⏸ Mission paused.'); loadMissions(); }
    else showToast('❌ Could not pause.');
    setActionLoading(null);
  };

  const filtered = missions.filter(m => {
    if (filter !== 'all' && m.status !== filter) return false;
    if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const statusCounts = missions.reduce((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="animate-spin" style={{ fontSize: '1.5rem', marginBottom: 12 }}>◌</div>
          <div style={{ fontSize: '0.85rem' }}>Loading missions…</div>
        </div>
      </div>
    );
  }

  return (
    <>
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)', animation: 'slideIn 0.2s ease' }}>
          {toast}
        </div>
      )}

      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="page-title">Missions</h1>
            <p className="page-subtitle">{missions.length} automation{missions.length !== 1 ? 's' : ''} in your workspace</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => router.push('/dashboard')}>← Command Center</button>
            <button className="btn btn-ghost btn-sm" onClick={() => router.push('/dashboard/runs')}>Run History</button>
            <button className="btn btn-primary btn-sm" onClick={() => router.push('/dashboard/creator')}>+ New Mission</button>
          </div>
        </div>
      </div>

      {/* Stats strip */}
      {missions.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {Object.entries(STATUS_LABELS).filter(([k]) => statusCounts[k]).map(([k, v]) => (
            <button
              key={k}
              onClick={() => setFilter(filter === k ? 'all' : k)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: filter === k ? 'var(--accent-subtle)' : 'var(--bg-card)', border: `1px solid ${filter === k ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 20, padding: '5px 12px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: filter === k ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLORS[k] }} />
              {statusCounts[k]} {v}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      {missions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Search missions…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', maxWidth: 380, padding: '8px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }}
          />
        </div>
      )}

      {/* Empty state */}
      {missions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>🎯</div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>No missions yet</h3>
          <p style={{ fontSize: '0.88rem', marginBottom: 24 }}>Create your first AI automation in minutes.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => router.push('/dashboard/creator')}>+ Create Mission</button>
            <button className="btn btn-ghost" onClick={() => router.push('/dashboard')}>Ask AI →</button>
          </div>
        </div>
      )}

      {/* Missions grid */}
      {filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {filtered.map(mission => {
            const lastRun = lastRuns[mission.id];
            const isLoading = actionLoading === mission.id;
            return (
              <div
                key={mission.id}
                className="card"
                style={{ padding: 18, cursor: 'pointer', transition: 'border-color 0.15s', display: 'flex', flexDirection: 'column', gap: 12 }}
                onClick={() => router.push(`/dashboard/missions/${mission.id}`)}
              >
                {/* Mission header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {mission.title}
                    </div>
                    {mission.description && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {mission.description}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[mission.status] ?? 'var(--text-muted)' }} />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>{STATUS_LABELS[mission.status] ?? mission.status}</span>
                  </div>
                </div>

                {/* Last run info */}
                {lastRun ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem' }}>
                    <span style={{ color: lastRun.status === 'completed' ? 'var(--emerald)' : lastRun.status === 'failed' ? '#ef4444' : 'var(--text-muted)' }}>
                      {lastRun.status === 'completed' ? '✓' : lastRun.status === 'failed' ? '✕' : lastRun.status === 'active' ? '⟳' : '◌'} Run #{lastRun.run_number}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>·</span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatAgo(lastRun.started_at)}</span>
                    {lastRun.duration_ms && (
                      <>
                        <span style={{ color: 'var(--text-muted)' }}>·</span>
                        <span style={{ color: 'var(--text-muted)' }}>{Math.round(lastRun.duration_ms / 1000)}s</span>
                      </>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '4px 0' }}>Never run</div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                  {(mission.status === 'draft' || mission.status === 'paused' || mission.status === 'failed' || mission.status === 'completed') && (
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ fontSize: '0.75rem', flex: 1 }}
                      disabled={isLoading}
                      onClick={() => handleStart(mission)}
                    >
                      {isLoading ? '…' : mission.status === 'draft' ? '▶ Run' : '↺ Re-run'}
                    </button>
                  )}
                  {mission.status === 'active' && (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.75rem', flex: 1, borderColor: '#f59e0b', color: '#f59e0b' }}
                      disabled={isLoading}
                      onClick={() => handlePause(mission)}
                    >
                      {isLoading ? '…' : '⏸ Pause'}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '0.75rem' }}
                    onClick={() => router.push(`/dashboard/missions/${mission.id}/chat`)}
                  >
                    Chat →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* No search results */}
      {missions.length > 0 && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          No missions match "{search || filter}". <button onClick={() => { setSearch(''); setFilter('all'); }} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>Clear filters</button>
        </div>
      )}

      {/* Templates section */}
      <div style={{ marginTop: 40, paddingTop: 30, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Start from a template</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Pre-built automations you can deploy in seconds</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/dashboard/creator')}>Browse all →</button>
        </div>
        <TemplatesPreview onFork={loadMissions} />
      </div>
    </>
  );
}

function TemplatesPreview({ onFork }: { onFork: () => void }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<{ id: string; slug: string; title: string; description: string; icon: string; category: string }[]>([]);
  const [forking, setForking] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/templates?featured=true')
      .then(r => r.json())
      .then((d: { templates?: typeof templates }) => setTemplates(d.templates?.slice(0, 6) ?? []))
      .catch(() => {});
  }, []);

  const handleFork = async (slug: string) => {
    setForking(slug);
    try {
      const res = await fetch('/api/templates', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) });
      if (res.ok) {
        const d = await res.json() as { mission_id: string };
        setToast('✅ Mission created!');
        setTimeout(() => { onFork(); router.push(`/dashboard/missions/${d.mission_id}`); }, 800);
      } else { setToast('❌ Could not create from template.'); }
    } catch { setToast('❌ Connection error.'); }
    setForking(null);
  };

  if (!templates.length) return null;

  return (
    <>
      {toast && <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>{toast}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {templates.map(t => (
          <div key={t.id} className="card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>{t.icon ?? '🎯'}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: 3 }}>{t.title}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.description}</div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.72rem' }}
                disabled={forking === t.slug}
                onClick={() => handleFork(t.slug)}
              >
                {forking === t.slug ? 'Creating…' : 'Use Template →'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
