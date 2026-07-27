"use client";
import { useState, useEffect, useCallback } from "react";

interface AuditEvent {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  entity_title: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  'billing': 'var(--amber)',
  'mission.run': 'var(--emerald)',
  'mission.failed': 'var(--rose)',
  'agent': 'var(--accent)',
  'email': 'var(--purple)',
  'mission.schedule': 'var(--text-muted)',
};

function eventColor(type: string): string {
  const prefix = Object.keys(EVENT_TYPE_COLORS).find(k => type.startsWith(k));
  return prefix ? EVENT_TYPE_COLORS[prefix] : 'var(--border)';
}

const EVENT_TYPE_GROUPS = [
  { label: 'All', value: '' },
  { label: 'Billing', value: 'billing' },
  { label: 'Missions', value: 'mission' },
  { label: 'Agents', value: 'agent' },
  { label: 'Email', value: 'email' },
  { label: 'AB Tests', value: 'ab_test' },
];

export default function AuditLogsPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const LIMIT = 50;

  const fetchLogs = useCallback(async (eventType: string, off: number) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
    if (eventType) params.set('event_type', eventType);
    const res = await fetch(`/api/audit-logs?${params}`);
    if (res.ok) {
      const data = await res.json() as { events: AuditEvent[]; total: number };
      setEvents(data.events);
      setTotal(data.total);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLogs(filter, offset); }, [filter, offset, fetchLogs]);

  const card: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', padding: 'var(--space-lg)',
  };

  return (
    <div className="page-container stack" style={{ gap: 'var(--space-lg)', maxWidth: 960 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: '1.5rem' }}>Audit Logs</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 4 }}>
          Complete history of all events — missions, billing, agents, email, A/B tests.
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {EVENT_TYPE_GROUPS.map(g => (
          <button key={g.value} onClick={() => { setFilter(g.value); setOffset(0); }}
            style={{ padding: '5px 14px', borderRadius: 20, border: '1px solid var(--border)',
              background: filter === g.value ? 'var(--accent)' : 'var(--surface)',
              color: filter === g.value ? '#fff' : 'var(--text)', cursor: 'pointer', fontSize: '0.85rem' }}>
            {g.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
          {total} events
        </span>
      </div>

      <div style={card}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
        ) : events.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>📋</div>
            No events found{filter ? ` for "${filter}"` : ''}.
          </div>
        ) : (
          <div className="stack" style={{ gap: 2 }}>
            {events.map(event => (
              <div key={event.id}>
                <div
                  onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6,
                    cursor: 'pointer', transition: 'background 0.1s',
                    background: expandedId === event.id ? 'var(--background)' : 'transparent' }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: eventColor(event.event_type) }} />
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flexShrink: 0, width: 140 }}>
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', flex: 1 }}>{event.event_type}</span>
                  {event.entity_title && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {event.entity_title}
                    </span>
                  )}
                  {(event.payload?.amount as number) > 0 && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--amber)', flexShrink: 0 }}>
                      -{event.payload.amount as number} cr
                    </span>
                  )}
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                    {expandedId === event.id ? '▲' : '▼'}
                  </span>
                </div>
                {expandedId === event.id && (
                  <div style={{ padding: '8px 10px 12px 28px' }}>
                    <pre style={{ fontSize: '0.78rem', color: 'var(--text-muted)', overflow: 'auto', maxHeight: 200,
                      background: 'var(--background)', borderRadius: 6, padding: 10, margin: 0 }}>
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-sm)' }}>
          <button className="btn" onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0}>
            ← Previous
          </button>
          <span style={{ alignSelf: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
          </span>
          <button className="btn" onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= total}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
