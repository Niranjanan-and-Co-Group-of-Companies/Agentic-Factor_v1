"use client";
import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface Step {
  id: string;
  title: string;
  description: string;
  action: string;
  actionHref?: string;
  icon: string;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const STEPS: Step[] = [
  {
    id: 'account',
    title: 'Create your account',
    description: 'Sign up with Google or email. Your workspace is ready to go.',
    action: 'Done ✓',
    icon: '👤',
  },
  {
    id: 'connector',
    title: 'Connect your tools',
    description: 'Add the apps your agent needs — Google, Slack, YouTube, Meta Ads, and more. You can connect any tool your mission requires.',
    action: 'Go to Connectors',
    actionHref: '/connectors',
    icon: '🔌',
  },
  {
    id: 'template',
    title: 'Pick a starting template',
    description: 'Browse ready-made mission blueprints: research reports, YouTube automation, paid ads management, lead enrichment, and more.',
    action: 'Browse Templates',
    actionHref: '/templates',
    icon: '📋',
  },
  {
    id: 'mission',
    title: 'Create your first mission',
    description: 'Describe what you want to automate in plain English. The AI builds a multi-agent blueprint for you to review before anything runs.',
    action: 'Create Mission',
    actionHref: '/dashboard?new=1',
    icon: '🚀',
  },
  {
    id: 'run',
    title: 'Run your mission',
    description: 'Click "Run Now" on any active mission. Watch each agent work in real-time on the mission detail page.',
    action: 'View Dashboard',
    actionHref: '/dashboard',
    icon: '▶',
  },
  {
    id: 'schedule',
    title: 'Schedule for automation',
    description: 'Set your mission to run daily, weekly, or on specific days. It runs completely hands-free — you just review the results.',
    action: 'View Dashboard',
    actionHref: '/dashboard',
    icon: '⏰',
  },
];

async function loadCompleted(): Promise<Set<string>> {
  try {
    const res = await fetch('/api/onboarding');
    if (res.ok) {
      const data = await res.json() as { completed: string[] };
      if (Array.isArray(data.completed) && data.completed.length > 0) {
        return new Set(data.completed);
      }
    }
  } catch { /* ignore */ }

  // Fall back to localStorage for offline / pre-auth state
  try {
    const saved = localStorage.getItem('onboarding_completed');
    if (saved) return new Set(JSON.parse(saved) as string[]);
  } catch { /* ignore */ }

  return new Set(['account']);
}

async function saveCompleted(completed: Set<string>): Promise<void> {
  const arr = [...completed];
  // Always mirror to localStorage as an instant cache
  try { localStorage.setItem('onboarding_completed', JSON.stringify(arr)); } catch { /* ignore */ }
  // Persist to DB (best-effort)
  try {
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: arr }),
    });
  } catch { /* ignore */ }
}

export default function OnboardingPage() {
  const [completed, setCompleted] = useState<Set<string>>(new Set(['account']));
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (u) setUser({ name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'there' });
    });

    loadCompleted().then(c => { setCompleted(c); setLoaded(true); });
  }, []);

  const markDone = useCallback((stepId: string) => {
    setCompleted(prev => {
      const next = new Set(prev);
      next.add(stepId);
      saveCompleted(next);
      return next;
    });
  }, []);

  const completedCount = completed.size;
  const totalSteps = STEPS.length;
  const pct = Math.round((completedCount / totalSteps) * 100);

  const card: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', padding: 'var(--space-lg)',
  };

  if (!loaded) {
    return <div className="page-container" style={{ color: 'var(--text-muted)', padding: 'var(--space-xl)' }}>Loading…</div>;
  }

  return (
    <div className="page-container stack" style={{ gap: 'var(--space-lg)', maxWidth: 720 }}>
      {/* Header */}
      <div style={{ ...card, background: 'color-mix(in srgb, var(--accent) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--accent) 25%, transparent)' }}>
        <div style={{ fontWeight: 700, fontSize: '1.4rem', marginBottom: 4 }}>
          Welcome{user ? `, ${user.name}` : ''}! 👋
        </div>
        <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
          Let&apos;s get your first autonomous mission running in under 10 minutes.
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          <span>{completedCount} of {totalSteps} steps completed</span>
          <span>{pct}%</span>
        </div>
        <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 4, transition: 'width 0.4s' }} />
        </div>
      </div>

      {/* Steps */}
      <div className="stack" style={{ gap: 'var(--space-sm)' }}>
        {STEPS.map((step, i) => {
          const isDone = completed.has(step.id);
          const isPrev = i === 0 || completed.has(STEPS[i - 1].id);
          return (
            <div key={step.id} style={{
              ...card,
              opacity: !isPrev ? 0.5 : 1,
              borderLeft: isDone ? '3px solid var(--emerald)' : isPrev ? '3px solid var(--accent)' : '3px solid var(--border)',
            }}>
              <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-start' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                  background: isDone ? 'color-mix(in srgb, var(--emerald) 15%, transparent)' : 'var(--background)',
                  border: `2px solid ${isDone ? 'var(--emerald)' : 'var(--border)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
                }}>
                  {isDone ? '✓' : step.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    Step {i + 1}: {step.title}
                    {isDone && <span style={{ fontSize: '0.75rem', color: 'var(--emerald)', fontWeight: 400 }}>Completed</span>}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: isDone ? 0 : 'var(--space-sm)' }}>
                    {step.description}
                  </div>
                  {!isDone && isPrev && (
                    <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                      {step.actionHref ? (
                        <a href={step.actionHref} className="btn btn-primary" style={{ textDecoration: 'none', fontSize: '0.85rem', padding: '6px 16px' }}>
                          {step.action} →
                        </a>
                      ) : (
                        <span style={{ fontSize: '0.85rem', color: 'var(--emerald)', fontWeight: 600 }}>{step.action}</span>
                      )}
                      <button
                        onClick={() => markDone(step.id)}
                        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        Mark done
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Done state */}
      {completedCount === totalSteps && (
        <div style={{ ...card, textAlign: 'center', background: 'color-mix(in srgb, var(--emerald) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--emerald) 30%, transparent)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🎉</div>
          <div style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: 8 }}>You&apos;re all set!</div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
            Your first autonomous mission is live. Keep building on the dashboard.
          </div>
          <a href="/dashboard" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Go to Dashboard →
          </a>
        </div>
      )}
    </div>
  );
}
