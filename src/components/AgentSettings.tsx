"use client";
import { useState, useRef, useEffect } from "react";

// ============================================================
// Agent Settings Gear — Live Governance Control
// Opens a mini-panel for live trust-level switching during
// mission execution. Accessible from any agent card or graph node.
// ============================================================

type TrustLevel = "manual" | "conditional" | "autonomous";

interface AgentSettingsProps {
  agentRole: string;
  currentTrust: TrustLevel;
  onTrustChange: (level: TrustLevel) => void | Promise<void>;
  successScore?: number | null;
  status?: string;
}

const TRUST_CONFIG: Record<TrustLevel, { label: string; icon: string; desc: string; color: string }> = {
  manual: { label: "Manual (HITL)", icon: "🛑", desc: "Every action requires human approval", color: "var(--amber)" },
  conditional: { label: "Conditional", icon: "💬", desc: "Ask before boundary decisions", color: "var(--accent)" },
  autonomous: { label: "Full Auto", icon: "⚡", desc: "Agent executes autonomously", color: "var(--emerald)" },
};

export default function AgentSettings({ agentRole, currentTrust, onTrustChange, successScore, status }: AgentSettingsProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <div ref={panelRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        className="agent-gear-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        title={`Settings: ${agentRole}`}
      >
        ⚙️
      </button>

      {open && (
        <div className="agent-settings-panel animate-slide-in" onClick={(e) => e.stopPropagation()} style={{ zIndex: 9999 }}>
          <div style={{ marginBottom: "var(--space-md)" }}>
            <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>⚙️ {agentRole}</div>
            {status && (
              <span className={`badge ${status === "running" ? "badge-green" : status === "paused" ? "badge-amber" : "badge-red"}`}
                style={{ fontSize: "0.6rem", marginTop: "4px" }}>{status}</span>
            )}
            {successScore !== null && successScore !== undefined && (
              <span style={{ marginLeft: "var(--space-sm)", fontSize: "0.8rem", fontWeight: 700,
                color: successScore >= 0.8 ? "var(--emerald)" : "var(--amber)" }}>
                {(successScore * 100).toFixed(0)}%
              </span>
            )}
          </div>

          <div className="input-label" style={{ marginBottom: "var(--space-xs)" }}>Trust Level (Live)</div>

          <div className="stack" style={{ gap: "var(--space-xs)" }}>
            {(["manual", "conditional", "autonomous"] as TrustLevel[]).map((level) => {
              const cfg = TRUST_CONFIG[level];
              const isActive = currentTrust === level;
              return (
                <button
                  key={level}
                  className={`agent-trust-option ${isActive ? "active" : ""}`}
                  style={isActive ? { borderColor: cfg.color, background: `${cfg.color}15` } : undefined}
                  onClick={() => {
                    if (level !== currentTrust) {
                      const confirmChange = window.confirm(
                        `Agent '${agentRole}' Trust Level is being changed from '${TRUST_CONFIG[currentTrust].label}' -> '${TRUST_CONFIG[level].label}'.\n\nAre you sure you want to proceed?`
                      );
                      if (confirmChange) {
                        onTrustChange(level);
                        setOpen(false);
                      }
                    } else {
                      setOpen(false);
                    }
                  }}
                >
                  <span style={{ fontSize: "1rem" }}>{cfg.icon}</span>
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.8rem", color: isActive ? cfg.color : "var(--text-primary)" }}>{cfg.label}</div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{cfg.desc}</div>
                  </div>
                  {isActive && <span style={{ color: cfg.color, fontSize: "0.9rem" }}>✓</span>}
                </button>
              );
            })}
          </div>

          <button className="btn btn-ghost btn-sm" style={{ width: "100%", marginTop: "var(--space-sm)" }}
            onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
