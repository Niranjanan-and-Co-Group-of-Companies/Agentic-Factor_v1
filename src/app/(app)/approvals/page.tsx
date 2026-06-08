"use client";
import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useAuthPopup } from "@/components/providers/AuthProvider";

// ============================================================
// Types
// ============================================================
interface ProposedAction {
  id: string; agentRole: string; description: string; target: string;
  riskLevel: "low" | "medium" | "high" | "critical"; status: "pending" | "approved" | "rejected";
  payload_redacted: Record<string, unknown>; submittedAt: string;
  missionTitle: string; explanation: string; reversible: boolean;
}

const riskColors: Record<string, string> = { low: "badge-green", medium: "badge-amber", high: "badge-red", critical: "badge-red" };

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ============================================================
// Approval Queue — Live Data + Circuit Breaker
// ============================================================
export default function ApprovalsPage() {
  const [actions, setActions] = useState<ProposedAction[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [circuitState, setCircuitState] = useState<string>("CLOSED");
  const [loading, setLoading] = useState(true);
  const [showExplanation, setShowExplanation] = useState<string | null>(null);
  
  const { triggerAuth } = useAuthPopup();

  // Map technical targets to simple human-readable labels
  const getActionDisplay = (target: string): { icon: string; label: string } => {
    const t = target.toLowerCase();
    if (t.includes('gmail') || t.includes('email')) return { icon: '📧', label: 'Send emails on your behalf' };
    if (t.includes('sheet') || t.includes('spreadsheet')) return { icon: '📊', label: 'Create & edit Google Sheets' };
    if (t.includes('calendar')) return { icon: '📅', label: 'Access your Google Calendar' };
    if (t.includes('drive')) return { icon: '📁', label: 'Access your Google Drive files' };
    if (t.includes('tavily') || t.includes('search') || t.includes('web')) return { icon: '🔍', label: 'Search the web' };
    if (t.includes('twitter') || t.includes('tweet')) return { icon: '🐦', label: 'Post to Twitter/X' };
    if (t.includes('slack')) return { icon: '💬', label: 'Send Slack messages' };
    if (t.includes('github')) return { icon: '🐙', label: 'Access GitHub' };
    if (t.includes('linkedin')) return { icon: '💼', label: 'Post to LinkedIn' };
    if (t.includes('notion')) return { icon: '📝', label: 'Access Notion' };
    if (t.includes('facebook') || t.includes('fb')) return { icon: '📘', label: 'Post to Facebook' };
    if (t.includes('instagram')) return { icon: '📷', label: 'Post to Instagram' };
    if (t.includes('discord')) return { icon: '🎮', label: 'Send Discord messages' };
    if (t.includes('whatsapp')) return { icon: '📱', label: 'Send WhatsApp messages' };
    return { icon: '🔌', label: 'Connect to external service' };
  };

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Fetch live data ──
  useEffect(() => {
    fetchActions();
    const interval = setInterval(fetchActions, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  const fetchActions = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: rows } = await supabase
      .from("proposed_actions")
      .select("id, agent_role, description, target, risk_level, status, payload_redacted, submitted_at, mission_title, explanation, reversible")
      .eq("tenant_id", user.id)
      .order("submitted_at", { ascending: false });

    if (rows) {
      setActions(rows.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        agentRole: (r.agent_role as string) || "Agent",
        description: (r.description as string) || "",
        target: (r.target as string) || "",
        riskLevel: (r.risk_level as ProposedAction["riskLevel"]) || "low",
        status: (r.status as ProposedAction["status"]) || "pending",
        payload_redacted: (r.payload_redacted as Record<string, unknown>) || {},
        submittedAt: (r.submitted_at as string) || new Date().toISOString(),
        missionTitle: (r.mission_title as string) || "Mission",
        explanation: (r.explanation as string) || "",
        reversible: (r.reversible as boolean) ?? true,
      })));
    }

    // Fetch circuit breaker status
    try {
      const res = await fetch("/api/approvals");
      if (res.ok) {
        const data = await res.json();
        if (data.circuitState) setCircuitState(data.circuitState);
      }
    } catch { /* silent */ }

    setLoading(false);
  };

  const handleDecision = async (id: string, decision: "approved" | "rejected") => {
    // Optimistic update
    setActions((prev) => prev.map((a) => a.id === id ? { ...a, status: decision } : a));

    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: id, decision, missionId: actions.find(a => a.id === id)?.missionTitle }),
      });
      const data = await res.json();

      if (!res.ok) {
        setActions((prev) => prev.map((a) => a.id === id ? { ...a, status: "pending" } : a));
        
        if (res.status === 403 && data.error === 'missing_permission') {
          showToast(`⚡ Missing permissions for ${data.providers.join(', ')}`, "error");
          triggerAuth(data.providers[0], () => handleDecision(id, decision));
          return;
        }
        
        showToast(`⚡ ${data.reason || data.error}`, "error");
        if (data.circuitState) setCircuitState(data.circuitState);
        return;
      }

      if (data.circuitState) setCircuitState(data.circuitState);
      showToast(`${decision === "approved" ? "✓" : "✗"} Action ${decision} · Circuit: ${data.circuitState}`, "success");
    } catch {
      showToast(`${decision === "approved" ? "✓" : "✗"} Action ${decision} (offline)`, "success");
    }
  };

  const handleUndo = (id: string) => {
    setActions((prev) => prev.map((a) => a.id === id ? { ...a, status: "pending" } : a));
  };

  const filtered = filter === "all" ? actions : actions.filter((a) => a.status === filter);
  const pendingCount = actions.filter((a) => a.status === "pending").length;

  // ── Loading state ──
  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1 className="page-title">✅ Approval Queue</h1>
          <p className="page-subtitle">Loading proposed actions...</p>
        </div>
        <div className="stack" style={{ gap: "var(--space-md)" }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="card" style={{ padding: "var(--space-lg)" }}>
              <div className="animate-glow" style={{ width: `${50 + i * 15}%`, height: 16, borderRadius: 4, background: "var(--border)", marginBottom: 12 }} />
              <div className="animate-glow" style={{ width: "80%", height: 12, borderRadius: 4, background: "var(--border)" }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  // ── Empty state ──
  if (actions.length === 0) {
    return (
      <>
        <div className="page-header">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h1 className="page-title">✅ Approval Queue</h1>
              <p className="page-subtitle">Review and approve proposed agent actions before execution</p>
            </div>
            <span className={`badge ${circuitState === "CLOSED" ? "badge-green" : "badge-red"}`}>⚡ {circuitState}</span>
          </div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "var(--space-2xl)" }}>
          <div style={{ fontSize: "3rem", marginBottom: "var(--space-md)" }}>✅</div>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>All Clear</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)" }}>
            No pending actions. Agents will post here when they need approval to proceed.
          </p>
          <a href="/" className="btn btn-primary">🎯 Create a Mission</a>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h1 className="page-title">✅ Approval Queue</h1>
            <p className="page-subtitle">Review and approve proposed agent actions before execution</p>
          </div>
          <div className="row">
            <div className="status-pill"><span className="status-dot active" /> Live</div>
            <span className={`badge ${circuitState === "CLOSED" ? "badge-green" : circuitState === "OPEN" ? "badge-red" : "badge-amber"}`}>⚡ {circuitState}</span>
            <span className="badge badge-amber">{pendingCount} Pending</span>
          </div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: "var(--space-lg)", gap: "var(--space-sm)" }}>
        {["all", "pending", "approved", "rejected"].map((f) => (
          <button key={f} className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="stack">
        {filtered.map((action) => {
          const display = getActionDisplay(action.target);
          return (
            <div key={action.id} className="card animate-slide-in" style={{ padding: "var(--space-lg)" }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
                <div className="row" style={{ gap: "var(--space-sm)" }}>
                  <span className="badge badge-purple" style={{ fontSize: "0.75rem" }}>🤖 {action.agentRole}</span>
                  <span className={`badge ${riskColors[action.riskLevel]}`} style={{ fontSize: "0.7rem", textTransform: "uppercase" }}>{action.riskLevel}</span>
                  {!action.reversible && <span className="badge badge-red" style={{ fontSize: "0.65rem" }}>⚠ Irreversible</span>}
                </div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{action.missionTitle}</span>
              </div>

              {/* Simple icon + label card */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", padding: "var(--space-md) var(--space-lg)", background: "var(--bg-glass)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-md)", border: "1px solid var(--border)" }}>
                <span style={{ fontSize: "2rem" }}>{display.icon}</span>
                <div>
                  <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 2 }}>{display.label}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{action.description || `This agent needs permission to proceed.`}</div>
                </div>
              </div>

              {/* Explanation (expandable) */}
              {action.explanation && (
                <button className="btn btn-ghost btn-sm" style={{ marginBottom: "var(--space-md)" }}
                  onClick={() => setShowExplanation(showExplanation === action.id ? null : action.id)}>
                  {showExplanation === action.id ? "▼ Hide" : "ℹ️ Why this agent needs this"}
                </button>
              )}
              {showExplanation === action.id && (
                <div className="animate-slide-in" style={{ fontSize: "0.82rem", color: "var(--text-secondary)", padding: "var(--space-sm) var(--space-md)", background: "var(--accent-subtle)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-md)", lineHeight: 1.6 }}>
                  {action.explanation}
                </div>
              )}

              {/* Action Buttons */}
              <div className="row" style={{ gap: "var(--space-sm)" }}>
                {action.status === "pending" ? (
                  <>
                    <button className="btn btn-success" style={{ padding: "8px 24px", fontSize: "0.9rem" }} onClick={() => handleDecision(action.id, "approved")}>✅ Allow</button>
                    <button className="btn btn-danger" style={{ padding: "8px 24px", fontSize: "0.9rem" }} onClick={() => handleDecision(action.id, "rejected")}>❌ Deny</button>
                  </>
                ) : (
                  <>
                    <span className={`badge ${action.status === "approved" ? "badge-green" : "badge-red"}`} style={{ padding: "6px 16px" }}>
                      {action.status === "approved" ? "✅ Allowed" : "❌ Denied"}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleUndo(action.id)}>↩ Undo</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: "var(--space-2xl)", color: "var(--text-muted)" }}>
            No {filter === "all" ? "" : filter} actions in queue
          </div>
        )}
      </div>
      {toast && <div className={`approval-toast ${toast.type}`}>{toast.message}</div>}
    </>
  );
}
