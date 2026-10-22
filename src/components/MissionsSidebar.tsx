'use client';

// The app's sidebar, as in Claude or ChatGPT: New chat, then Chats (one-time conversations, by date) or
// Missions (automations) — one switch, a search over either, and credits at the bottom. Missions with
// a run going or waiting on the customer are counted on the switch, so nothing is hidden behind it.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { sanitizeTitle } from '@/lib/utils/sanitize-title';

import { LogoMark } from "@/components/brand/Logo";
import { RunDot } from '@/components/runs/LiveRunCard';
import { useActiveRuns } from '@/components/runs/useLiveRun';

interface Mission {
  id: string;
  title: string;
  status: string;
}

interface Chat {
  id: string;
  title: string;
  updated_at: string;
}

interface Credits {
  remaining: number;
  topup: number;
  used: number;
  plan: string;
}

interface Props {
  activeMissionId?: string; // undefined = Command Center is active
  /** The Command Center conversation open now. */
  activeChatId?: string | null;
  /** Changes when a chat is created or updated, so the list refreshes. */
  chatsVersion?: number;
}

type Tab = 'chats' | 'missions';

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function byDate(chats: Chat[]): Array<[string, Chat[]]> {
  const groups: Record<string, Chat[]> = {};
  const now = Date.now();
  for (const c of chats) {
    const days = Math.floor((now - new Date(c.updated_at).getTime()) / 86_400_000);
    const key = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days <= 7 ? 'This week' : 'Older';
    (groups[key] ??= []).push(c);
  }
  return ['Today', 'Yesterday', 'This week', 'Older'].filter(k => groups[k]).map(k => [k, groups[k]]);
}

const sectionLabel: React.CSSProperties = {
  fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.5px', padding: '8px 8px 4px',
};

export default function MissionsSidebar({ activeMissionId, activeChatId, chatsVersion }: Props) {
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [query, setQuery] = useState('');
  // A mission's page opens on Missions, the Command Center on Chats.
  const [tab, setTab] = useState<Tab>(activeMissionId ? 'missions' : 'chats');
  // Missions with a run going now (pulsing dot) or waiting on an approval (amber dot).
  const activeRuns = useActiveRuns();
  const needYou = Object.keys(activeRuns).length;

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [missionsRes, creditsRes] = await Promise.all([
      supabase
        .from('missions')
        .select('id, title, status')
        .eq('tenant_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(50),
      supabase
        .from('tenant_billing')
        .select('credits_remaining, credits_topup, credits_used_this_month, plan')
        .eq('tenant_id', user.id)
        .single(),
    ]);

    if (missionsRes.data) setMissions(missionsRes.data);
    if (creditsRes.data) {
      setCredits({
        remaining: creditsRes.data.credits_remaining ?? 0,
        topup: creditsRes.data.credits_topup ?? 0,
        used: creditsRes.data.credits_used_this_month ?? 0,
        plan: creditsRes.data.plan ?? 'free',
      });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The Command Center conversations, newest first (refreshed when one is created or updated).
  useEffect(() => {
    let stopped = false;
    fetch('/api/command-chat/sessions', { credentials: 'include', cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { sessions: [] }))
      .then((d: { sessions?: Chat[] }) => { if (!stopped) setChats(d.sessions ?? []); })
      .catch(() => {});
    return () => { stopped = true; };
  }, [chatsVersion]);

  const chooseTab = (next: Tab) => {
    setTab(next);
    setQuery('');
  };

  const deleteChat = async (chat: Chat, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${chat.title}"?`)) return;
    await fetch('/api/command-chat/sessions', {
      method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: chat.id }),
    }).catch(() => {});
    setChats(prev => prev.filter(c => c.id !== chat.id));
    if (chat.id === activeChatId) router.push('/dashboard?fresh=1');
  };

  const q = query.trim().toLowerCase();
  const shownChats = useMemo(() => (q ? chats.filter(c => c.title.toLowerCase().includes(q)) : chats), [chats, q]);
  const shownMissions = useMemo(() => (q ? missions.filter(m => sanitizeTitle(m.title).toLowerCase().includes(q)) : missions), [missions, q]);

  const total = credits ? credits.remaining + credits.topup : 0;
  // Fuel gauge: what's left out of what was available this period. It used to show the monthly bucket's
  // share of the balance, so 12,947 credits (mostly top-up) drew a bar 38% full.
  const creditPct = credits ? Math.min(100, Math.round(total / Math.max(total + credits.used, 1) * 100)) : 0;

  const rowStyle = (active: boolean): React.CSSProperties => ({
    width: '100%', textAlign: 'left',
    background: active ? 'var(--accent-subtle)' : 'none',
    border: active ? '1px solid color-mix(in srgb, var(--emerald) 20%, transparent)' : '1px solid transparent',
    borderRadius: 'var(--radius-sm)',
    padding: '7px 8px',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 7,
    overflow: 'hidden',
    marginBottom: 1,
    transition: 'background 0.12s',
  });
  const rowText = (active: boolean): React.CSSProperties => ({
    flex: 1, minWidth: 0,
    fontSize: '0.78rem',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontWeight: active ? 600 : 400,
  });
  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, border: 'none', borderRadius: 6, padding: '6px 0', cursor: 'pointer',
    fontSize: '0.74rem', fontWeight: 600, fontFamily: 'var(--font-sans)',
    background: active ? 'var(--bg-card)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  });

  return (
    <div style={{
      width: 236, flexShrink: 0,
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-secondary)',
      overflow: 'hidden',
    }}>
      {/* Brand + New chat */}
      <div style={{ padding: '14px 10px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
          <LogoMark size={20} />
          <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>Agentic Factor</div>
        </div>
        <button
          onClick={() => router.push('/dashboard?fresh=1')}
          className="btn btn-primary btn-sm"
          style={{ width: '100%', justifyContent: 'center', fontSize: '0.78rem' }}
        >
          + New chat
        </button>
        <div role="tablist" aria-label="Show chats or missions" style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <button role="tab" aria-selected={tab === 'chats'} onClick={() => chooseTab('chats')} style={tabStyle(tab === 'chats')}>Chats</button>
          <button role="tab" aria-selected={tab === 'missions'} onClick={() => chooseTab('missions')} style={tabStyle(tab === 'missions')}>
            Missions
            {needYou > 0 && (
              <span title="Running or waiting for you" style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: 'var(--amber)', color: '#1a1a1a', fontSize: '0.6rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {needYou}
              </span>
            )}
          </button>
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={tab === 'chats' ? 'Search chats' : 'Search missions'}
          aria-label={tab === 'chats' ? 'Search chats' : 'Search missions'}
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 9px', fontSize: '0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px 8px' }}>
        {tab === 'chats' ? (
          shownChats.length > 0 ? byDate(shownChats).map(([label, group]) => (
            <div key={label}>
              <div style={sectionLabel}>{label}</div>
              {group.map(c => {
                const isActive = !activeMissionId && c.id === activeChatId;
                return (
                  <div key={c.id} className="af-chat-row" style={{ position: 'relative' }}>
                    <button onClick={() => router.push(`/dashboard?chat=${c.id}`)} title={c.title} style={rowStyle(isActive)}>
                      <span style={rowText(isActive)}>{c.title}</span>
                    </button>
                    <button
                      onClick={e => deleteChat(c, e)}
                      aria-label={`Delete "${c.title}"`}
                      className="af-chat-delete"
                      style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'var(--bg-secondary)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '2px 5px', borderRadius: 4 }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )) : (
            <div style={{ padding: '24px 12px', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
              {q ? 'No chats match.' : 'Your conversations will appear here.'}
            </div>
          )
        ) : shownMissions.length > 0 ? (
          <>
            <div style={sectionLabel}>Missions</div>
            {shownMissions.map(m => {
              const isActive = m.id === activeMissionId;
              return (
                <button
                  key={m.id}
                  onClick={() => router.push(`/dashboard/missions/${m.id}/chat`)}
                  title={sanitizeTitle(m.title)}
                  style={rowStyle(isActive)}
                >
                  <span style={rowText(isActive)}>{sanitizeTitle(m.title)}</span>
                  <RunDot state={activeRuns[m.id]} />
                </button>
              );
            })}
          </>
        ) : (
          <div style={{ padding: '24px 12px', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
            {q ? 'No missions match.' : <>No missions yet.<br />
              <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => router.push('/dashboard?fresh=1')}>
                Ask for something to run regularly →
              </span></>}
          </div>
        )}
      </div>

      {/* Credits pill at bottom */}
      {credits && (
        <div style={{ padding: '10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            onClick={() => router.push('/dashboard/usage')}
            style={{
              width: '100%', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              padding: '7px 10px', cursor: 'pointer', textAlign: 'left',
            }}
          >
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginBottom: 3 }}>
              Credits · {credits.plan}
            </div>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              {total.toLocaleString()} remaining
            </div>
            <div style={{ height: 3, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4,
                background: total < 100 ? 'var(--rose)' : 'var(--accent)',
                width: `${creditPct}%`,
              }} />
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
