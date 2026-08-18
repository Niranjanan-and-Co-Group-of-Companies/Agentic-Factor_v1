"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

interface RunData {
  run: {
    id: string; run_number: number; trigger: string; status: string;
    started_at: string; completed_at: string | null; duration_ms: number | null;
    agents_total: number; agents_done: number; agents_failed: number; summary: string | null;
  };
  events: Array<{ id: string; type: string; payload: Record<string, unknown>; timestamp: string }>;
  agents: Array<{ name: string; role: string; output?: string; events: unknown[] }>;
  creditsUsed: number;
  eventCount: number;
}

const EVENT_ICONS: Record<string, string> = {
  'agent.started': '▶',
  'agent.completed': '✓',
  'agent.failed': '✗',
  'agent.tool_call': '🔧',
  'mission.started': '🚀',
  'mission.completed': '🎉',
  'mission.failed': '💥',
  'billing.credit_used': '💳',
  'mission.approval_needed': '⚠️',
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'var(--emerald)', failed: 'var(--rose)', running: 'var(--amber)',
};

function formatDuration(ms: number | null) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const [data, setData] = useState<RunData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missionId, setMissionId] = useState<string | null>(null);

  // Resolve missionId: sessionStorage fast path, then API lookup fallback
  useEffect(() => {
    const stored = sessionStorage.getItem(`run_mission_${runId}`);
    if (stored) { setMissionId(stored); return; }
    // No sessionStorage — look up via API (handles direct links, refreshes, shared URLs)
    fetch(`/api/runs/${runId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<{ missionId: string }> : Promise.reject())
      .then(d => { if (d.missionId) setMissionId(d.missionId); else { setError('Run not found'); setLoading(false); } })
      .catch(() => { setError('Run not found'); setLoading(false); });
  }, [runId]);

  const fetchRun = useCallback(async (mId: string) => {
    const res = await fetch(`/api/missions/${mId}/runs/${runId}`);
    if (!res.ok) { setError('Run not found'); setLoading(false); return; }
    setData(await res.json() as RunData);
    setLoading(false);
  }, [runId]);

  useEffect(() => { if (missionId) fetchRun(missionId); }, [missionId, fetchRun]);

  const exportJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-${runId?.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const card: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', padding: 'var(--space-lg)',
  };

  // missionId is being resolved (API lookup in progress) — show loader
  if (!missionId && loading) {
    return <div className="page-container"><div style={{ color: 'var(--text-muted)' }}>Loading run details…</div></div>;
  }

  if (loading) return <div className="page-container"><div style={{ color: 'var(--text-muted)' }}>Loading run details...</div></div>;
  if (error || !data) return <div className="page-container"><div style={{ color: 'var(--rose)' }}>{error ?? 'Error loading run'}</div></div>;

  const run = data.run;

  return (
    <div className="page-container stack" style={{ gap: 'var(--space-lg)', maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.5rem' }}>
            Run #{run.run_number}
            <span style={{ marginLeft: 12, fontSize: '0.9rem', fontWeight: 400, color: STATUS_COLORS[run.status] ?? 'var(--text-muted)' }}>
              {run.status}
            </span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            {new Date(run.started_at).toLocaleString()} · {formatDuration(run.duration_ms)} · triggered by {run.trigger}
          </div>
        </div>
        <button className="btn" onClick={exportJson} style={{ fontSize: '0.85rem' }}>
          ⬇ Export JSON
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-md)' }}>
        {[
          { label: 'Agents Run', value: run.agents_total, color: 'var(--accent)' },
          { label: 'Completed', value: run.agents_done, color: 'var(--emerald)' },
          { label: 'Failed', value: run.agents_failed, color: run.agents_failed > 0 ? 'var(--rose)' : 'var(--text-muted)' },
          { label: 'Credits Used', value: data.creditsUsed, color: 'var(--amber)' },
          { label: 'Events', value: data.eventCount, color: 'var(--purple)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ ...card, borderLeft: `3px solid ${color}` }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Summary */}
      {run.summary && (
        <div style={{ ...card, background: 'color-mix(in srgb, var(--emerald) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--emerald) 30%, transparent)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Run Summary</div>
          <div style={{ fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{run.summary}</div>
        </div>
      )}

      {/* Per-agent output */}
      {data.agents.length > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 'var(--space-md)' }}>Agent Outputs</div>
          <div className="stack" style={{ gap: 'var(--space-md)' }}>
            {data.agents.map((agent, i) => (
              <div key={i} style={{ padding: 'var(--space-md)', background: 'var(--background)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{agent.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>{agent.role}</div>
                {agent.output ? (
                  <div style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 200, overflow: 'auto' }}>
                    {agent.output}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No output captured for this agent</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Event log */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 'var(--space-md)' }}>Event Log ({data.events.length})</div>
        <div style={{ maxHeight: 500, overflow: 'auto' }}>
          {data.events.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No events recorded for this run window.</div>
          ) : (
            <div className="stack" style={{ gap: 4 }}>
              {data.events.map((event) => (
                <div key={event.id} style={{ display: 'flex', gap: 10, padding: '6px 8px', borderRadius: 6, fontSize: '0.82rem',
                  background: event.type.includes('failed') ? 'color-mix(in srgb, var(--rose) 8%, transparent)' : 'transparent' }}>
                  <span style={{ flexShrink: 0, width: 18, textAlign: 'center' }}>{EVENT_ICONS[event.type] ?? '·'}</span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0, width: 80 }}>
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                  <span style={{ fontFamily: 'monospace', color: event.type.includes('failed') ? 'var(--rose)' : 'var(--text)' }}>
                    {event.type}
                  </span>
                  {(event.payload?.amount as number) > 0 && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>-{event.payload.amount as number} cr</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
