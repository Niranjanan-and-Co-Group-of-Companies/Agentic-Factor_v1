"use client";
import { useState, useEffect, useCallback } from "react";

// ============================================================
// GuidedTour — Spotlight onboarding with blackout overlay
// Shows first-time users a step-by-step walkthrough of the UI.
// Each step highlights one element with a spotlight circle.
// ============================================================

interface TourStep {
  selector: string;
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right";
}

interface GuidedTourProps {
  steps: TourStep[];
  storageKey?: string;
}

export default function GuidedTour({ steps, storageKey = "agentfactory_onboarded" }: GuidedTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [show, setShow] = useState(false);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const done = localStorage.getItem(storageKey);
    if (!done) {
      // Delay to let the page render
      const t = setTimeout(() => setShow(true), 1200);
      return () => clearTimeout(t);
    }
  }, [storageKey]);

  const updateSpotlight = useCallback(() => {
    if (!show || currentStep >= steps.length) return;
    const el = document.querySelector(steps[currentStep].selector);
    if (el) {
      const rect = el.getBoundingClientRect();
      setSpotlightRect(rect);
    } else {
      setSpotlightRect(null);
    }
  }, [show, currentStep, steps]);

  useEffect(() => {
    updateSpotlight();
    window.addEventListener("resize", updateSpotlight);
    return () => window.removeEventListener("resize", updateSpotlight);
  }, [updateSpotlight]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleSkip();
    }
  };

  const handleSkip = () => {
    localStorage.setItem(storageKey, "true");
    setShow(false);
  };

  if (!show || currentStep >= steps.length) return null;

  const step = steps[currentStep];
  const pad = 12;

  // Calculate tooltip position
  const getTooltipStyle = (): React.CSSProperties => {
    if (!spotlightRect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    const pos = step.position || "bottom";
    switch (pos) {
      case "bottom":
        return { top: spotlightRect.bottom + pad + 16, left: spotlightRect.left + spotlightRect.width / 2, transform: "translateX(-50%)" };
      case "top":
        return { bottom: window.innerHeight - spotlightRect.top + pad + 16, left: spotlightRect.left + spotlightRect.width / 2, transform: "translateX(-50%)" };
      case "right":
        return { top: spotlightRect.top + spotlightRect.height / 2, left: spotlightRect.right + pad + 16, transform: "translateY(-50%)" };
      case "left":
        return { top: spotlightRect.top + spotlightRect.height / 2, right: window.innerWidth - spotlightRect.left + pad + 16, transform: "translateY(-50%)" };
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
      {/* Blackout overlay with spotlight cutout via SVG */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlightRect && (
              <rect
                x={spotlightRect.left - pad}
                y={spotlightRect.top - pad}
                width={spotlightRect.width + pad * 2}
                height={spotlightRect.height + pad * 2}
                rx={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.75)" mask="url(#tour-mask)" />
      </svg>

      {/* Spotlight border glow */}
      {spotlightRect && (
        <div style={{
          position: "absolute",
          left: spotlightRect.left - pad,
          top: spotlightRect.top - pad,
          width: spotlightRect.width + pad * 2,
          height: spotlightRect.height + pad * 2,
          borderRadius: 12,
          border: "2px solid hsl(217, 91%, 60%)",
          boxShadow: "0 0 24px hsla(217, 91%, 60%, 0.4)",
          pointerEvents: "none",
          transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        }} />
      )}

      {/* Tooltip */}
      <div style={{
        position: "fixed",
        ...getTooltipStyle(),
        background: "hsl(222, 35%, 12%)",
        border: "1px solid hsla(217, 91%, 60%, 0.3)",
        borderRadius: 16,
        padding: "20px 24px",
        maxWidth: 340,
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        zIndex: 10000,
        animation: "slideIn 0.3s ease",
      }}>
        {/* Step counter */}
        <div style={{ fontSize: "0.7rem", color: "hsl(215,15%,60%)", marginBottom: 8, fontWeight: 600, letterSpacing: 1 }}>
          STEP {currentStep + 1} OF {steps.length}
        </div>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: 6, color: "hsl(210,20%,92%)" }}>{step.title}</h3>
        <p style={{ fontSize: "0.84rem", color: "hsl(215,15%,60%)", lineHeight: 1.6, marginBottom: 16 }}>{step.description}</p>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={handleSkip}
            style={{ background: "none", border: "none", color: "hsl(215,15%,60%)", fontSize: "0.8rem", cursor: "pointer", padding: "6px 12px" }}
          >
            Skip Tutorial
          </button>
          <button
            onClick={handleNext}
            style={{
              background: "linear-gradient(135deg, hsl(217,91%,60%), hsl(230,80%,55%))",
              color: "white", border: "none", padding: "8px 20px",
              borderRadius: 8, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
            }}
          >
            {currentStep < steps.length - 1 ? "Next →" : "Get Started! 🚀"}
          </button>
        </div>
        {/* Step dots */}
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 12 }}>
          {steps.map((_, i) => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: "50%",
              background: i === currentStep ? "hsl(217,91%,60%)" : "hsla(215,20%,25%,0.5)",
              transition: "all 0.3s",
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}
