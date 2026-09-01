'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

interface Mission {
  id: string;
  title: string;
  status: string;
}

interface Credits {
  remaining: number;
  topup: number;
  plan: string;
}

interface Props {
  activeMissionId?: string; // undefined = Command Center is active
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}


export default function MissionsSidebar({ activeMissionId }: Props) {
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [credits, setCredits] = useState<Credits | null>(null);

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
        .select('credits_remaining, credits_topup, plan')
        .eq('tenant_id', user.id)
        .single(),
    ]);

    if (missionsRes.data) setMissions(missionsRes.data);
    if (creditsRes.data) {
      setCredits({
        remaining: creditsRes.data.credits_remaining ?? 0,
        topup: creditsRes.data.credits_topup ?? 0,
        plan: creditsRes.data.plan ?? 'free',
      });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isCommandCenter = !activeMissionId;
  const total = credits ? credits.remaining + credits.topup : 0;
  const creditPct = credits ? Math.min(100, Math.round(credits.remaining / Math.max(total, 1) * 100)) : 0;

  return (
    <div style={{
      width: 224, flexShrink: 0,
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-secondary)',
      overflow: 'hidden',
    }}>
      {/* Command Center entry */}
      <div style={{ padding: '14px 10px 8px', borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            width: '100%', textAlign: 'left',
            background: isCommandCenter ? 'var(--accent-subtle)' : 'none',
            border: isCommandCenter ? '1px solid hsla(152,69%,50%,0.2)' : '1px solid transparent',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 10px',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '0.8rem', fontWeight: 700,
              color: isCommandCenter ? 'var(--accent)' : 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              Command Center
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>AI Chief of Staff</div>
          </div>
        </button>
      </div>

      {/* Missions list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {missions.length > 0 ? (
          <>
            <div style={{
              fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              padding: '4px 8px 4px',
            }}>
              Missions
            </div>
            {missions.map(m => {
              const isActive = m.id === activeMissionId;
              return (
                <button
                  key={m.id}
                  onClick={() => router.push(`/dashboard/missions/${m.id}/chat`)}
                  title={m.title}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: isActive ? 'var(--accent-subtle)' : 'none',
                    border: isActive ? '1px solid hsla(152,69%,50%,0.2)' : '1px solid transparent',
                    borderRadius: 'var(--radius-sm)',
                    padding: '7px 8px',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 7,
                    overflow: 'hidden',
                    marginBottom: 1,
                    transition: 'background 0.12s',
                  }}
                >
                  <span style={{
                    fontSize: '0.78rem',
                    color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: isActive ? 600 : 400,
                  }}>
                    {m.title}
                  </span>
                </button>
              );
            })}
          </>
        ) : (
          <div style={{
            padding: '24px 12px', fontSize: '0.75rem',
            color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6,
          }}>
            No missions yet.<br />
            <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => router.push('/dashboard')}>
              Create one in Command Center →
            </span>
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
                background: credits.remaining < 100 ? '#ef4444' : 'var(--accent)',
                width: `${creditPct}%`,
              }} />
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
