"use client";
import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface Step {
  id: string;
  title: string;
  description: string;
  action: string;
  actionHref?: string;
  checkFn?: () => Promise<boolean>;
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
    description: 'Sign up with Google or email. Your workspace is ready.',
    action: 'Done ✓',
    icon: '👤',
  },
  {
    id: 'connector',
    title: 'Connect a data source',
    description: 'Add Apollo.io for prospect research and Google or Zoho for email sending. These power your first outreach mission.',
    action: 'Go to Connectors',
    actionHref: '/connectors',
    icon: '🔌',
  },
  {
    id: 'template',
    title: 'Start from a template',
    description: 'Pick the "Cold Email Outreach Campaign" template — it\'s pre-built with Apollo + email tools. Just customise your ICP.',
    action: 'Browse Templates',
    actionHref: '/templates',
    icon: '📋',
  },
  {
    id: 'mission',
    title: 'Create your first mission',
    description: 'Describe what you want to automate in plain English. The AI will build a multi-agent blueprint for you to review.',
    action: 'Create Mission',
    actionHref: '/dashboard/creator',
    icon: '🚀',
  },
  {
    id: 'run',
    title: 'Run your mission',
    description: 'Click "Run Now" on any active mission. Watch agents work in real-time on the mission detail page.',
    action: 'View Dashboard',
    actionHref: '/dashboard',
    icon: '▶',
  },
  {
    id: 'schedule',
    title: 'Set a schedule',
    description: 'Set your outreach mission to run daily at 9am. It will find new prospects and send emails automatically every day.',
    action: 'View Dashboard',
    actionHref: '/dashboard',
    icon: '⏰',
  },
];

export default function OnboardingPage() {
  const [completed, setCompleted] = useState<Set<string>>(new Set(['account']));
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (u) {
        setUser({
          name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'there',
          email: u.email || '',
        });
      }
    });

    // Check completion state from localStorage
    const saved = localStorage.getItem('onboarding_completed');
    if (saved) {
      try { setCompleted(new Set(JSON.parse(saved) as string[])); } catch { /* ignore */ }
    }
  }, []);

  const markDone = (stepId: string) => {
    setCompleted(prev => {
      const next = new Set(prev);
      next.add(stepId);
      localStorage.setItem('onboarding_completed', JSON.stringify([...next]));
      return next;
    });
  };

  const completedCount = completed.size;
  const totalSteps = STEPS.length;
  const pct = Math.round((completedCount / totalSteps) * 100);

  const card: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', padding: 'var(--space-lg)',
  };

  return (
    <div className="page-container stack" style={{ gap: 'var(--space-lg)', maxWidth: 720 }}>
      {/* Header */}
      <div style={{ ...card, background: 'color-mix(in srgb, var(--accent) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--accent) 25%, transparent)' }}>
        <div style={{ fontWeight: 700, fontSize: '1.4rem', marginBottom: 4 }}>
          Welcome{user ? `, ${user.name}` : ''}! 👋
        </div>
        <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
          Let&apos;s get your first autonomous outreach mission running in under 10 minutes.
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
            Your first autonomous outreach pipeline is live. Monitor it on the dashboard.
          </div>
          <a href="/dashboard" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Go to Dashboard →
          </a>
        </div>
      )}
    </div>
  );
}
