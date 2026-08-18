"use client";
import { useState, useEffect } from "react";

const TOUR_KEY = "af-tour-done";

const STEPS = [
  {
    icon: "⚡",
    title: "Welcome to Agentic Factor",
    description:
      "Your AI Chief of Staff. Describe what you want automated — it plans the agents, you approve, and it runs completely hands-free.",
  },
  {
    icon: "🚀",
    title: "Create Your First Mission",
    description:
      "Click \"+ New Mission\" and type what you want to automate in plain English. The AI builds a full multi-agent blueprint in seconds.",
  },
  {
    icon: "🔌",
    title: "Connect Your Tools",
    description:
      "Go to Connectors and link Google, Slack, YouTube, HubSpot, and 100+ apps. Your agents will then act on your behalf inside those tools.",
  },
  {
    icon: "📈",
    title: "Track Usage & Credits",
    description:
      "Every AI action is logged. Visit Usage & Credits anytime to see what's running, how many credits you've used, and top up if needed.",
  },
  {
    icon: "💬",
    title: "Help Is Always Here",
    description:
      "Ask the Command Center anything — it knows your missions, credits, and integrations. Or hit Support in the sidebar for the team.",
  },
];

export default function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(TOUR_KEY)) setVisible(true);
    } catch {
      // storage blocked (private mode etc.)
    }
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* */ }
    setVisible(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else dismiss();
  };

  const prev = () => setStep(s => Math.max(0, s - 1));

  if (!visible) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Getting started tour"
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "var(--space-lg)",
        background: "hsla(222, 47%, 5%, 0.88)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          width: "100%", maxWidth: 480,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          padding: "var(--space-2xl)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.5)",
          animation: "slideIn 0.25s var(--ease)",
          display: "flex", flexDirection: "column", gap: "var(--space-lg)",
        }}
      >
        {/* Progress bar */}
        <div style={{ display: "flex", gap: 5 }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1, height: 3, borderRadius: 99,
                background: i <= step ? "var(--accent)" : "var(--border)",
                transition: "background 0.3s ease",
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "3.2rem", marginBottom: "var(--space-md)", lineHeight: 1 }}>
            {current.icon}
          </div>
          <h2 style={{
            fontSize: "1.25rem", fontWeight: 700,
            color: "var(--text-primary)", marginBottom: "var(--space-sm)",
          }}>
            {current.title}
          </h2>
          <p style={{
            color: "var(--text-secondary)", fontSize: "0.9rem",
            lineHeight: 1.7, margin: 0,
          }}>
            {current.description}
          </p>
        </div>

        {/* Step counter */}
        <div style={{ textAlign: "center", fontSize: "0.72rem", color: "var(--text-muted)" }}>
          {step + 1} of {STEPS.length}
        </div>

        {/* Navigation */}
        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
          {!isFirst && (
            <button
              onClick={prev}
              style={{
                background: "none", border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)", padding: "8px 16px",
                cursor: "pointer", fontSize: "0.85rem", color: "var(--text-secondary)",
                fontFamily: "var(--font-sans)",
              }}
            >
              ← Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={dismiss}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "0.82rem", color: "var(--text-muted)",
              fontFamily: "var(--font-sans)", padding: "8px",
            }}
          >
            Skip
          </button>
          <button
            onClick={next}
            className="btn btn-primary"
            style={{ minWidth: 120, justifyContent: "center" }}
          >
            {isLast ? "Get Started →" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}
