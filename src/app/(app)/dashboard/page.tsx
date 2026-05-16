"use client";
import { useState, useEffect } from "react";
import UnifiedInput from "@/components/UnifiedInput";
import AgentSettings from "@/components/AgentSettings";
import FileDropZone from "@/components/FileDropZone";
import GuidedTour from "@/components/GuidedTour";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";

// ============================================================
// Types
// ============================================================
interface MissionCard { id: string; title: string; status: string; agentCount: number; pattern: string; score: number | null; createdAt: string; }
const statusMap: Record<string, { dot: string; label: string }> = {
  active: { dot: "active", label: "Active" },
  building: { dot: "pending", label: "Building" },
  pending_approval: { dot: "pending", label: "Awaiting Approval" },
  failed: { dot: "failed", label: "Failed" },
  deadlocked: { dot: "failed", label: "Deadlocked" },
  draft: { dot: "idle", label: "Draft" },
  completed: { dot: "active", label: "Completed" },
};

const TOUR_STEPS = [
  { selector: "#create-mission-btn", title: "Create a Mission", description: "Describe what you want your AI agents to do — in plain English. The AI will design the optimal team.", position: "bottom" as const },
  { selector: ".sidebar", title: "Navigation", description: "Access your Dashboard, Connectors, Credentials, and Pricing from here.", position: "right" as const },
  { selector: "#credit-balance", title: "Credit Balance", description: "Every agent action costs credits. Track your usage here and upgrade when needed.", position: "bottom" as const },
  { selector: ".missions-folder", title: "Your Missions", description: "All your missions appear here with live status updates. Click any to see details.", position: "right" as const },
];


function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ============================================================
// Dashboard — Collaborative Command Center (LIVE DATA)
// ============================================================
export default function DashboardPage() {
  // ── Live data state ──
  const [missions, setMissions] = useState<MissionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState<{ remaining: number; total: number; plan: string } | null>(null);

  const [circuitState, setCircuitState] = useState<"CLOSED" | "OPEN" | "HALF_OPEN">("CLOSED");

  // ── Fetch all live data ──
  useEffect(() => {
    fetchData();
    // Poll every 15s for live updates
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      // No session — redirect to login (login gate)
      window.location.href = '/login?returnTo=/dashboard';
      return;
    }
    const uid = user.id;

    // ── Fetch missions ──
    const { data: missionRows } = await supabase
      .from("missions")
      .select("id, title, status, validation_report, created_at")
      .eq("tenant_id", uid)
      .order("created_at", { ascending: false });

    if (missionRows) {
      setMissions(missionRows.map((m: Record<string, unknown>) => ({
        id: m.id as string,
        title: m.title as string,
        status: (m.status as string) || "draft",
        agentCount: 0,
        pattern: "sequential",
        score: null,
        createdAt: formatTimeAgo(m.created_at as string),
      })));
    }

    // ── Fetch circuit breaker status ──
    try {
      const res = await fetch("/api/approvals");
      if (res.ok) {
        const data = await res.json();
        if (data.circuitState) setCircuitState(data.circuitState);
      }
    } catch { /* circuit breaker API not available */ }

    // ── Fetch credit balance ──
    try {
      const { data: billing } = await supabase
        .from("tenant_billing")
        .select("plan, credits_remaining, credits_total")
        .eq("tenant_id", uid)
        .single();
      if (billing) {
        setCredits({
          remaining: billing.credits_remaining ?? 30,
          total: billing.credits_total ?? 30,
          plan: billing.plan || "free",
        });
      } else {
        setCredits({ remaining: 30, total: 30, plan: "free" });
      }
    } catch {
      setCredits({ remaining: 30, total: 30, plan: "free" });
    }

    setLoading(false);
  };

  const handleStartMission = async (missionId: string) => {
    try {
      const res = await fetch(`/api/missions/${missionId}/execute`, { method: "POST" });
      if (res.status === 403) {
        // Missing permissions, redirect to detail page where JIT OAuth popup handles it
        window.location.href = `/dashboard/missions/${missionId}`;
        return;
      }
      if (!res.ok) {
        throw new Error("Failed to start mission");
      }
      // Immediately refresh to see starting events
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Execution failed to start.");
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1 className="page-title">📊 Command Center</h1>
          <p className="page-subtitle">Loading mission intelligence...</p>
        </div>
        <div className="grid-4" style={{ marginBottom: "var(--space-xl)" }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="card stat-card">
              <div className="animate-glow" style={{ width: 40, height: 32, borderRadius: 6, background: "var(--border)", marginBottom: 8 }} />
              <div className="animate-glow" style={{ width: 80, height: 14, borderRadius: 4, background: "var(--border)" }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  // ── Empty state ──
  if (missions.length === 0) {
    return (
      <>
        <div className="page-header">
          <h1 className="page-title">📊 Command Center</h1>
          <p className="page-subtitle">Live mission intelligence, clarifications, and timeline</p>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "var(--space-2xl)" }}>
          <div style={{ fontSize: "3rem", marginBottom: "var(--space-md)" }}>🚀</div>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>No Missions Yet</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)" }}>
            Create your first mission to see real-time agent intelligence, clarifications, and orchestration graphs here.
          </p>
          <a href="/dashboard/creator" className="btn btn-primary btn-lg">✨ Create Your First Mission</a>
        </div>
      </>
    );
  }

  return (
    <>
      <GuidedTour steps={TOUR_STEPS} />

      <div className="page-header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h1 className="page-title">📊 Command Center</h1>
            <p className="page-subtitle">Live mission intelligence, clarifications, and timeline</p>
          </div>
          <div className="row">
            <a href="/dashboard/creator" id="create-mission-btn" className="btn btn-primary">✨ New Mission</a>
            <span className={`badge ${circuitState === "CLOSED" ? "badge-green" : "badge-red"}`}>{circuitState}</span>
          </div>
        </div>
      </div>

      {/* Credit Balance Card */}
      {credits && (
        <div id="credit-balance" className="card" style={{ marginBottom: "var(--space-xl)", padding: "var(--space-md) var(--space-lg)", background: "linear-gradient(135deg, hsla(217,91%,60%,0.06), hsla(270,70%,60%,0.04))", border: "1px solid hsla(217,91%,60%,0.15)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--space-sm)" }}>
            <div className="row" style={{ gap: "var(--space-md)" }}>
              <span style={{ fontSize: "1.3rem" }}>🪙</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1rem" }}>{credits.remaining} / {credits.total} credits</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "capitalize" }}>{credits.plan === "free" ? "Free Trial" : credits.plan} Plan</div>
              </div>
            </div>
            <a href="/pricing" className="btn btn-ghost btn-sm" style={{ textDecoration: "none" }}>Upgrade →</a>
          </div>
          <div className="gauge-container">
            <div className={`gauge-fill ${credits.remaining / credits.total > 0.5 ? "safe" : credits.remaining / credits.total > 0.2 ? "warn" : "danger"}`} style={{ width: `${Math.max(2, (credits.remaining / credits.total) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid-2" style={{ marginBottom: "var(--space-xl)" }}>
        <div className="card stat-card"><div className="stat-value" style={{ color: "var(--accent)" }}>{missions.length}</div><div className="stat-label">Total Missions</div></div>
        <div className="card stat-card"><div className="stat-value" style={{ color: "var(--emerald)" }}>{missions.filter(m => m.status === "active").length}</div><div className="stat-label">Active</div></div>
      </div>

      {/* ═══════ MISSIONS OVERVIEW ═══════ */}
      <div className="card">
        <div className="card-header"><span className="card-title">Missions</span></div>
        <div className="stack" style={{ gap: "var(--space-sm)" }}>
          {missions.map((m) => {
            const s = statusMap[m.status] || statusMap.draft;
            return (
              <Link href={`/dashboard/missions/${m.id}`} key={m.id} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card" style={{ padding: "var(--space-md)", transition: "border-color 0.2s, background 0.2s" }} onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--accent)"} onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <div className="row" style={{ gap: "var(--space-sm)", alignItems: "center" }}>
                        <div style={{ fontWeight: 600, fontSize: "1rem" }}>{m.title}</div>
                        {m.status === "draft" ? (
                          <button className="btn btn-primary btn-sm" onClick={(e) => { e.preventDefault(); handleStartMission(m.id); }}>
                            ▶ Start Mission
                          </button>
                        ) : null}
                      </div>
                      <div className="row" style={{ marginTop: "var(--space-xs)" }}>
                        <span className="status-pill"><span className={`status-dot ${s.dot}`} />{s.label}</span>
                        <span className="badge badge-purple" style={{ fontSize: "0.65rem" }}>{m.pattern}</span>
                        {m.agentCount > 0 && <span className="badge badge-blue" style={{ fontSize: "0.65rem" }}>{m.agentCount} agents</span>}
                        <span className="badge badge-gray" style={{ fontSize: "0.65rem" }}>{formatTimeAgo(m.createdAt)}</span>
                      </div>
                    </div>
                    {m.score !== null && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "1.1rem", fontWeight: 800, color: m.score >= 0.8 ? "var(--emerald)" : m.score >= 0.6 ? "var(--amber)" : "var(--rose)" }}>{(m.score * 100).toFixed(0)}%</div>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>success</div>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Utility: format ISO timestamp to "Xm ago" ──
function formatTimeAgo(iso: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
