"use client";
import { useEffect, useState, useCallback } from "react";

// ============================================================
// Usage Analytics Dashboard
// Shows credit spend, run history, per-mission stats, and
// lets users set a monthly spending cap.
// ============================================================

interface BillingData {
  plan: string;
  credits_remaining: number;
  credits_topup: number;
  credits_total: number;
  credits_used_this_month: number;
  billing_period_start: string;
  billing_period_end: string | null;
  monthly_credit_limit: number | null;
  billing_status: string;
  is_trial: boolean;
}

interface DailyCount {
  completed: number;
  failed: number;
  total: number;
}

interface UsageData {
  billing: BillingData | null;
  missions: { total: number; byStatus: Record<string, number> };
  runs: {
    total: number;
    completed: number;
    failed: number;
    byDay: Record<string, DailyCount>;
    byTrigger: Record<string, number>;
  };
  topMissions: Array<{ id: string; title: string; runCount: number; lastRun: string | null }>;
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free Trial",
  individual: "Individual",
  pro: "Pro",
  enterprise: "Enterprise",
};

const TRIGGER_ICONS: Record<string, string> = {
  manual: "▶️",
  scheduled: "⏰",
  webhook: "🔗",
};

function BarChart({ data }: { data: Record<string, DailyCount> }) {
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return d.toISOString().slice(0, 10);
  });

  const maxTotal = Math.max(...days.map(d => data[d]?.total ?? 0), 1);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "80px", padding: "0 4px" }}>
      {days.map((day) => {
        const count = data[day] ?? { completed: 0, failed: 0, total: 0 };
        const heightPct = (count.total / maxTotal) * 100;
        const failedPct = count.total > 0 ? (count.failed / count.total) * 100 : 0;
        const label = new Date(day + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return (
          <div key={day} title={`${label}: ${count.total} runs (${count.completed} ok, ${count.failed} failed)`}
            style={{ flex: 1, minWidth: 0, height: `${Math.max(heightPct, count.total > 0 ? 4 : 1)}%`,
              background: count.total === 0 ? "var(--border)" :
                failedPct > 30 ? "var(--rose)" : "var(--emerald)",
              borderRadius: "2px 2px 0 0", cursor: "default", transition: "opacity 0.15s",
              opacity: count.total === 0 ? 0.3 : 1 }} />
        );
      })}
    </div>
  );
}

export default function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [limitInput, setLimitInput] = useState<string>("");
  const [savingLimit, setSavingLimit] = useState(false);
  const [limitSaved, setLimitSaved] = useState(false);

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/usage");
      if (res.ok) {
        const json = await res.json() as UsageData;
        setData(json);
        setLimitInput(json.billing?.monthly_credit_limit?.toString() ?? "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  const saveLimit = async () => {
    setSavingLimit(true);
    const val = limitInput.trim() === "" ? null : parseInt(limitInput, 10);
    const res = await fetch("/api/billing/usage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_credit_limit: val }),
    });
    if (res.ok) {
      setLimitSaved(true);
      setTimeout(() => setLimitSaved(false), 2500);
      await fetchUsage();
    }
    setSavingLimit(false);
  };

  const billing = data?.billing;
  const usedPct = billing
    ? Math.min(100, Math.round((billing.credits_used_this_month / Math.max(billing.credits_total, 1)) * 100))
    : 0;
  const limitPct = billing?.monthly_credit_limit
    ? Math.min(100, Math.round((billing.credits_used_this_month / billing.monthly_credit_limit) * 100))
    : null;

  const card: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: "var(--radius)", padding: "var(--space-lg)",
  };

  if (loading) {
    return (
      <div className="page-container stack" style={{ gap: "var(--space-lg)" }}>
        <div style={{ fontWeight: 700, fontSize: "1.5rem" }}>Usage & Credits</div>
        <div style={{ color: "var(--text-muted)" }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="page-container stack" style={{ gap: "var(--space-lg)", maxWidth: 900 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: "1.5rem" }}>Usage & Credits</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: 4 }}>
          Credit spend, run history, and spending controls for your account.
        </div>
      </div>

      {/* ── Credit Summary ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-md)" }}>
        {[
          { label: "Credits Remaining", value: billing?.credits_remaining ?? "—", accent: "var(--emerald)" },
          { label: "Used This Month", value: billing?.credits_used_this_month ?? "—", accent: "var(--accent)" },
          { label: "Monthly Allowance", value: billing?.credits_total ?? "—", accent: "var(--purple)" },
          { label: "Total Runs (60d)", value: data?.runs.total ?? "—", accent: "var(--amber)" },
        ].map(({ label, value, accent }) => (
          <div key={label} style={{ ...card, borderLeft: `3px solid ${accent}` }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: accent }}>{value}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── Plan & Usage Bar ── */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-md)" }}>
          <div>
            <span style={{ fontWeight: 600 }}>{PLAN_LABELS[billing?.plan ?? "free"] ?? billing?.plan}</span>
            {billing?.is_trial && (
              <span style={{ marginLeft: 8, fontSize: "0.75rem", background: "var(--amber)", color: "#000",
                borderRadius: 4, padding: "2px 6px", fontWeight: 600 }}>TRIAL</span>
            )}
          </div>
          <a href="/pricing" style={{ fontSize: "0.85rem", color: "var(--accent)" }}>Upgrade →</a>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem",
            color: "var(--text-muted)", marginBottom: 4 }}>
            <span>Monthly credit usage</span>
            <span>{billing?.credits_used_this_month ?? 0} / {billing?.credits_total ?? 0}</span>
          </div>
          <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${usedPct}%`,
              background: usedPct > 80 ? "var(--rose)" : usedPct > 60 ? "var(--amber)" : "var(--emerald)",
              borderRadius: 4, transition: "width 0.4s" }} />
          </div>
        </div>

        {limitPct !== null && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem",
              color: "var(--text-muted)", marginBottom: 4 }}>
              <span>Spending cap progress</span>
              <span>{billing?.credits_used_this_month} / {billing?.monthly_credit_limit} cap</span>
            </div>
            <div style={{ height: 6, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${limitPct}%`,
                background: limitPct > 90 ? "var(--rose)" : "var(--amber)",
                borderRadius: 4, transition: "width 0.4s" }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Run History Chart ── */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: "var(--space-sm)" }}>
          Runs — Last 30 Days
        </div>
        <BarChart data={data?.runs.byDay ?? {}} />
        <div style={{ display: "flex", gap: "var(--space-md)", marginTop: "var(--space-sm)", fontSize: "0.78rem", color: "var(--text-muted)" }}>
          <span><span style={{ color: "var(--emerald)" }}>■</span> Completed ({data?.runs.completed ?? 0})</span>
          <span><span style={{ color: "var(--rose)" }}>■</span> Failed ({data?.runs.failed ?? 0})</span>
          {Object.entries(data?.runs.byTrigger ?? {}).map(([trigger, count]) => (
            <span key={trigger}>{TRIGGER_ICONS[trigger] ?? "▶️"} {trigger}: {count}</span>
          ))}
        </div>
      </div>

      {/* ── Top Missions ── */}
      {(data?.topMissions?.length ?? 0) > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: "var(--space-md)" }}>Most Active Missions</div>
          <div className="stack" style={{ gap: "var(--space-sm)" }}>
            {data!.topMissions.map((m) => (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "var(--space-sm) var(--space-md)", background: "var(--background)",
                borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                <div>
                  <a href={`/dashboard/missions/${m.id}`} style={{ fontWeight: 500, color: "var(--text)", textDecoration: "none" }}>
                    {m.title}
                  </a>
                  {m.lastRun && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
                      Last run {new Date(m.lastRun).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div style={{ fontWeight: 700, color: "var(--accent)", fontSize: "1.1rem" }}>
                  {m.runCount} <span style={{ fontWeight: 400, fontSize: "0.8rem", color: "var(--text-muted)" }}>runs</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Mission Status Breakdown ── */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: "var(--space-md)" }}>Mission Status</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)" }}>
          {Object.entries(data?.missions.byStatus ?? {}).map(([status, count]) => {
            const colors: Record<string, string> = {
              active: "var(--emerald)", building: "var(--amber)", draft: "var(--purple)",
              failed: "var(--rose)", deadlocked: "var(--rose)", completed: "var(--text-muted)",
            };
            return (
              <div key={status} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.9rem" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%",
                  background: colors[status] ?? "var(--border)", display: "inline-block" }} />
                <span style={{ textTransform: "capitalize" }}>{status}</span>
                <span style={{ fontWeight: 700 }}>{count}</span>
              </div>
            );
          })}
          {(data?.missions.total ?? 0) === 0 && (
            <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No missions yet</span>
          )}
        </div>
      </div>

      {/* ── Credit Forecast ── */}
      {billing && billing.credits_used_this_month > 0 && (() => {
        const periodStart = billing.billing_period_start ? new Date(billing.billing_period_start) : new Date();
        const daysSinceStart = Math.max(1, Math.floor((Date.now() - periodStart.getTime()) / (24 * 60 * 60 * 1000)));
        const dailyBurnRate = billing.credits_used_this_month / daysSinceStart;
        const remaining = (billing.credits_remaining ?? 0) + (billing.credits_topup ?? 0);
        const daysUntilEmpty = dailyBurnRate > 0 ? Math.floor(remaining / dailyBurnRate) : null;
        const projectedMonthly = Math.round(dailyBurnRate * 30);
        return (
          <div style={card}>
            <div style={{ fontWeight: 600, marginBottom: 'var(--space-md)' }}>Credit Forecast</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-md)' }}>
              <div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent)' }}>
                  {dailyBurnRate.toFixed(1)}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Credits / day (avg)</div>
              </div>
              <div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--purple)' }}>
                  {projectedMonthly}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Projected this month</div>
              </div>
              <div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: daysUntilEmpty !== null && daysUntilEmpty < 7 ? 'var(--rose)' : 'var(--emerald)' }}>
                  {daysUntilEmpty !== null ? `${daysUntilEmpty}d` : '∞'}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Until credits run out</div>
              </div>
            </div>
            {daysUntilEmpty !== null && daysUntilEmpty < 7 && (
              <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-sm) var(--space-md)',
                background: 'color-mix(in srgb, var(--rose) 10%, transparent)', borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem', color: 'var(--rose)' }}>
                ⚠ Credits will run out in {daysUntilEmpty} day{daysUntilEmpty !== 1 ? 's' : ''}.{' '}
                <a href="/pricing" style={{ color: 'var(--rose)', textDecoration: 'underline' }}>Buy a top-up →</a>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Spending Cap ── */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Monthly Spending Cap</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "var(--space-md)" }}>
          Stop all missions automatically if credit usage hits this limit. Leave blank for no cap.
        </div>
        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
          <input
            type="number"
            min={0}
            placeholder="e.g. 800"
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            style={{ width: 120, padding: "var(--space-sm) var(--space-md)", background: "var(--background)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              color: "var(--text)", fontSize: "0.9rem" }}
          />
          <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>credits / month</span>
          <button className="btn btn-primary" onClick={saveLimit} disabled={savingLimit}
            style={{ marginLeft: "auto" }}>
            {savingLimit ? "Saving..." : limitSaved ? "✓ Saved" : "Save Cap"}
          </button>
        </div>
        {billing?.monthly_credit_limit && (
          <div style={{ marginTop: "var(--space-sm)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Current cap: <strong>{billing.monthly_credit_limit}</strong> credits/month
          </div>
        )}
      </div>
    </div>
  );
}
