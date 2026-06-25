"use client";
import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";

// ============================================================
// Pricing Page — Credit-Based Plans + Razorpay Checkout
// ============================================================

const plans = [
  {
    id: "free",
    name: "Free",
    subtitle: "Trial",
    price: "$0",
    period: "forever",
    description: "Try the power of AI agents",
    credits: "30 credits (one-time)",
    features: [
      { label: "30 credits", detail: "one-time, no refill" },
      { label: "1 active mission", detail: "concurrent" },
      { label: "Flash models only", detail: "Gemini Flash, GPT-4o-mini, Claude Haiku" },
      { label: "100MB storage", detail: "for RAG documents" },
      { label: "2 connectors", detail: "Google only" },
      { label: "No scheduling", detail: "manual runs only" },
      { label: "No multi-role agents", detail: "" },
      { label: "No top-ups", detail: "upgrade to purchase" },
    ],
    cta: "Start Free Trial",
    highlight: false,
    badge: null,
  },
  {
    id: "individual",
    name: "Individual",
    subtitle: "Prosumer",
    price: "$29",
    priceUsd: "",
    period: "/month",
    description: "For solo founders & power users",
    credits: "1,000 credits/month",
    features: [
      { label: "1,000 credits/month", detail: "auto-refills" },
      { label: "5 active missions", detail: "concurrent" },
      { label: "Mixed models", detail: "Flash + Pro (Claude Sonnet, Gemini Pro, GPT-4o)" },
      { label: "10GB storage", detail: "for RAG documents" },
      { label: "10 connectors", detail: "Google, GitHub, Slack, etc." },
      { label: "✓ Scheduling", detail: "cron, daily, weekly (1 cr/day)" },
      { label: "Up to 2 parallel roles", detail: "multi-role missions" },
      { label: "✓ Credit top-ups", detail: "buy more when needed" },
      { label: "Basic Memory", detail: "agents learn from past missions" },
      { label: "Email support", detail: "within 24 hours" },
    ],
    cta: "Upgrade",
    highlight: true,
    badge: "Most Popular",
  },
  {
    id: "pro",
    name: "Pro",
    subtitle: "Teams",
    price: "From $53",
    priceUsd: "",
    period: "/month",
    description: "$27 base + $26/seat",
    credits: "1,000 credits/seat/month",
    features: [
      { label: "1,000 credits/seat/month", detail: "scales with team" },
      { label: "50 active missions", detail: "concurrent" },
      { label: "All models", detail: "Claude Sonnet 4, Gemini Pro, GPT-4o + Premium" },
      { label: "100GB storage", detail: "for RAG documents" },
      { label: "100+ connectors", detail: "all available integrations" },
      { label: "✓ Scheduling", detail: "cron, daily, weekly (1 cr/day)" },
      { label: "Unlimited parallel roles", detail: "multi-role fan-out missions" },
      { label: "✓ Credit top-ups", detail: "buy more when needed" },
      { label: "Role-based access", detail: "RBAC for team governance" },
      { label: "5-6 discovery questions", detail: "thorough agent setup" },
      { label: "Priority support", detail: "within 4 hours" },
      { label: "Agent email inbox", detail: "per mission" },
    ],
    cta: "Configure",
    highlight: false,
    badge: null,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    subtitle: "",
    price: "Custom",
    period: "",
    description: "Unlimited everything",
    credits: "Unlimited credit pool",
    features: [
      { label: "Unlimited credits", detail: "no caps" },
      { label: "Unlimited missions", detail: "concurrent" },
      { label: "All + Custom fine-tunes", detail: "Claude, Gemini, GPT + your models" },
      { label: "1TB+ storage", detail: "enterprise-grade" },
      { label: "All connectors", detail: "custom integrations included" },
      { label: "✓ Scheduling", detail: "included, no extra charge" },
      { label: "Unlimited parallel roles", detail: "multi-role fan-out missions" },
      { label: "Full audit logs", detail: "compliance-ready" },
      { label: "Dedicated support", detail: "SLA guarantee" },
      { label: "SSO / SAML", detail: "" },
      { label: "On-premise option", detail: "" },
    ],
    cta: "Contact Sales",
    highlight: false,
    badge: null,
  },
];

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function PricingPage() {
  const [currentPlan, setCurrentPlan] = useState<string>("free");
  const [creditsRemaining, setCreditsRemaining] = useState<number>(30);
  const [creditsTopup, setCreditsTopup] = useState<number>(0);
  const [billingStatus, setBillingStatus] = useState<string>("active");
  const [loading, setLoading] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [seatCount, setSeatCount] = useState(1);

  useEffect(() => { fetchBilling(); }, []);

  const fetchBilling = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setIsLoggedIn(true);

    const { data } = await supabase
      .from("tenant_billing")
      .select("plan, credits_remaining, credits_topup, billing_status")
      .eq("tenant_id", user.id)
      .single();

    if (data?.plan) setCurrentPlan(data.plan);
    if (data?.credits_remaining != null) setCreditsRemaining(data.credits_remaining);
    if (data?.credits_topup != null) setCreditsTopup(data.credits_topup);
    if (data?.billing_status) setBillingStatus(data.billing_status);
  };

  const handleUpgrade = async (planId: string) => {
    if (planId === "enterprise") {
      window.location.href = "mailto:hello@agenticfactor.io?subject=Enterprise%20Plan%20Inquiry";
      return;
    }
    if (planId === "free") return;

    if (!isLoggedIn) {
      window.location.href = "/login?returnTo=/pricing";
      return;
    }

    setLoading(planId);
    try {
      const res = await fetch("/api/razorpay/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, quantity: planId === "pro" ? seatCount : 1, baseFee: planId === "pro" ? 2299 : 0, seatPrice: planId === "pro" ? 2249 : 0 }),
      });

      const data = await res.json();

      if (!res.ok) {
        setToast(data.message || data.error);
        setLoading(null);
        return;
      }

      if (data.shortUrl) {
        window.open(data.shortUrl, "_blank");
      } else if (data.subscriptionId && data.keyId) {
        const options = {
          key: data.keyId,
          subscription_id: data.subscriptionId,
          name: "Agentic Factor",
          description: `${planId.charAt(0).toUpperCase() + planId.slice(1)} Plan`,
          handler: function () {
            setToast("🎉 Payment successful! Credits will be activated shortly.");
            setTimeout(() => window.location.reload(), 3000);
          },
          theme: { color: "#6366f1" },
        };
        const rzp = new (window as any).Razorpay(options);
        rzp.open();
      }
    } catch {
      setToast("Payment failed. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      <div className="page-header" style={{ textAlign: "center" }}>
        <h1 className="page-title" style={{ fontSize: "2.2rem" }}>
          Credit-Based Pricing
        </h1>
        <p className="page-subtitle" style={{ maxWidth: 640, margin: "0 auto", lineHeight: 1.7 }}>
          Every agent action costs credits. Start with 30 free credits and upgrade when you need more power.
        </p>
        {isLoggedIn && (
          <>
            <div style={{ marginTop: "var(--space-md)", display: "inline-flex", alignItems: "center", gap: "var(--space-md)", padding: "8px 20px", background: "var(--bg-glass)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
              <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Your balance:</span>
              <span style={{ fontSize: "1.1rem", fontWeight: 800, color: "var(--accent)" }}>{creditsRemaining.toLocaleString()} monthly{creditsTopup > 0 ? ` + ${creditsTopup.toLocaleString()} top-up` : ''}</span>
              <span className={`badge ${currentPlan === 'free' ? 'badge-amber' : 'badge-green'}`} style={{ fontSize: "0.7rem" }}>{currentPlan.toUpperCase()}</span>
            </div>
            {billingStatus === 'cancelled' && creditsTopup > 0 && (
              <div style={{ marginTop: "var(--space-sm)", padding: "8px 16px", background: "hsla(45,90%,50%,0.1)", borderRadius: "var(--radius-sm)", border: "1px solid hsla(45,90%,50%,0.3)", fontSize: "0.78rem", color: "hsla(45,90%,70%,1)" }}>
                🔒 You have <strong>{creditsTopup}</strong> frozen top-up credits. Resubscribe to unlock them.
              </div>
            )}
          </>
        )}
      </div>

      {/* Credit cost explainer */}
      <div className="card" style={{ maxWidth: 800, margin: "0 auto var(--space-xl)", padding: "var(--space-lg)", background: "hsla(231,97%,68%,0.05)", borderColor: "hsla(231,97%,68%,0.2)" }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "var(--space-md)" }}>💡 How Credits Work</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "var(--space-md)" }}>
          {[
            { action: "Flash LLM Call", cost: "4 credits", icon: "⚡" },
            { action: "Pro LLM Call", cost: "12 credits", icon: "🧠" },
            { action: "Premium LLM Call", cost: "20 credits", icon: "💎" },
            { action: "Code Execution", cost: "8 credits", icon: "🖥️" },
          ].map((item, i) => (
            <div key={i} style={{ textAlign: "center", padding: "var(--space-sm)", background: "var(--bg-card)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "1.3rem", marginBottom: 4 }}>{item.icon}</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 600 }}>{item.action}</div>
              <div style={{ fontSize: "0.72rem", color: "var(--accent)" }}>{item.cost}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Plan cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(265px, 1fr))", gap: "var(--space-lg)", maxWidth: 1200, margin: "0 auto" }}>
        {plans.map((plan) => (
          <div key={plan.id} className="card" style={{
            position: "relative", padding: "var(--space-xl)",
            border: plan.highlight ? "2px solid var(--accent)" : "1px solid var(--border)",
            background: plan.highlight ? "linear-gradient(180deg, hsla(231,97%,68%,0.08) 0%, var(--bg-card) 100%)" : "var(--bg-card)",
            transform: plan.highlight ? "scale(1.03)" : undefined,
            transition: "all 0.3s ease",
            display: "flex", flexDirection: "column",
          }}>
            {plan.badge && (
              <div style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)", background: "var(--accent)", color: "white", padding: "4px 16px", borderRadius: 20, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {plan.badge}
              </div>
            )}

            <div style={{ marginBottom: "var(--space-lg)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>{plan.name}</h3>
                {plan.subtitle && <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 500 }}>{plan.subtitle}</span>}
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "4px 0 var(--space-md)" }}>{plan.description}</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: "2rem", fontWeight: 800 }}>{plan.price}</span>
                {plan.priceUsd && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>({plan.priceUsd})</span>}
                <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{plan.period}</span>
              </div>
              <div style={{ marginTop: 8, padding: "6px 12px", background: "hsla(155,80%,40%,0.1)", borderRadius: "var(--radius-sm)", border: "1px solid hsla(155,80%,40%,0.2)", display: "inline-block" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--emerald)" }}>🪙 {plan.credits}</span>
              </div>
            </div>

            {/* Features list — flex-grow to push bottom items down */}
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 var(--space-lg) 0", flex: 1 }}>
              {plan.features.map((f, i) => (
                <li key={i} style={{ fontSize: "0.8rem", padding: "6px 0", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ display: "flex", gap: 6, alignItems: "flex-start", minWidth: 0 }}>
                    <span style={{ color: "var(--emerald)", fontSize: "0.75rem", flexShrink: 0, marginTop: 2 }}>✓</span>
                    <span style={{ wordBreak: "break-word" }}>{f.label}</span>
                  </span>
                  {f.detail && <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", textAlign: "right", minWidth: 60, wordBreak: "break-word" }}>{f.detail}</span>}
                </li>
              ))}
            </ul>

            {/* Seat slider for Pro — BOTTOM position */}
            {plan.id === "pro" && (
              <div style={{ marginBottom: "var(--space-md)", padding: "var(--space-md)", background: "var(--bg-glass)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Team Size</span>
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--accent)" }}>{seatCount} {seatCount === 1 ? 'seat' : 'seats'}</span>
                </div>
                <input
                  type="range" min={1} max={50} value={seatCount}
                  onChange={e => setSeatCount(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "hsl(217,91%,60%)" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 4 }}>
                  <span>1</span><span>50</span>
                </div>
                <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--bg-card)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: 4 }}>
                    <span style={{ color: "var(--text-muted)" }}>Base platform fee</span>
                    <span>$27</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: 4 }}>
                    <span style={{ color: "var(--text-muted)" }}>{seatCount} × $26/seat</span>
                    <span>${(26 * seatCount).toLocaleString("en-US")}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginBottom: 4, color: "var(--emerald)" }}>
                    <span>Credits included</span>
                    <span>{(1000 * seatCount).toLocaleString("en-US")} credits/mo</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", fontWeight: 800, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                    <span>Total</span>
                    <span style={{ color: "var(--accent)" }}>${(27 + 26 * seatCount).toLocaleString("en-US")}/mo</span>
                  </div>
                </div>
              </div>
            )}

            {/* Enterprise contact — BOTTOM position */}
            {plan.id === "enterprise" && (
              <div style={{ marginBottom: "var(--space-md)", padding: "var(--space-md)", background: "var(--bg-glass)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  <p style={{ marginBottom: 8 }}>📧 <a href="mailto:enterprise@agenticfactor.io" style={{ color: "var(--accent)" }}>enterprise@agenticfactor.io</a></p>
                  <p style={{ marginBottom: 8 }}>📞 <a href="tel:+919446415489" style={{ color: "var(--accent)" }}>+91 94464 15489</a></p>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Custom pricing, SLA, dedicated support, SSO/SAML, on-premise options.</p>
                </div>
              </div>
            )}

            {currentPlan === plan.id ? (
              <button className="btn btn-ghost" style={{ width: "100%" }} disabled>✓ Current Plan</button>
            ) : plan.id === "free" && isLoggedIn ? (
              <button className="btn btn-ghost" style={{ width: "100%" }} disabled>Trial Active</button>
            ) : (
              <button
                className={`btn ${plan.highlight ? "btn-primary" : "btn-ghost"}`}
                style={{ width: "100%" }}
                onClick={() => handleUpgrade(plan.id)}
                disabled={loading === plan.id}
              >
                {loading === plan.id ? "Processing..." : plan.cta}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ═══════ CREDIT TOP-UP PACKS ═══════ */}
      <div style={{ maxWidth: 800, margin: "var(--space-2xl) auto 0" }}>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 700, textAlign: "center", marginBottom: "var(--space-sm)" }}>⚡ Credit Top-Up Packs</h2>
        <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: "var(--space-lg)" }}>
          Need more credits mid-month? Buy top-up packs. Available for Individual &amp; Pro plans only.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-md)" }}>
          {[
            { name: "Starter Pack", credits: 200, price: 7, originalPrice: null, discount: null, packId: "starter" },
            { name: "Power Pack", credits: 500, price: 15, originalPrice: 18, discount: "13.4%", packId: "power" },
            { name: "Mega Pack", credits: 1500, price: 42, originalPrice: 53, discount: "22.2%", packId: "mega" },
          ].map((pack, i) => (
            <div key={i} className="card" style={{ padding: "var(--space-lg)", textAlign: "center", position: "relative" }}>
              {pack.discount && (
                <div style={{ position: "absolute", top: -10, right: 12, background: "var(--emerald)", color: "white", padding: "2px 10px", borderRadius: 12, fontSize: "0.65rem", fontWeight: 700 }}>
                  {pack.discount} OFF
                </div>
              )}
              <div style={{ fontSize: "1.5rem", marginBottom: 4 }}>{i === 0 ? "🔋" : i === 1 ? "⚡" : "🚀"}</div>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 8 }}>{pack.name}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--accent)", marginBottom: 4 }}>
                {pack.credits.toLocaleString()} credits
              </div>
              <div style={{ marginBottom: 12 }}>
                {pack.originalPrice && (
                  <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", textDecoration: "line-through", marginRight: 6 }}>
                    ${pack.originalPrice.toLocaleString("en-US")}
                  </span>
                )}
                <span style={{ fontSize: "1.1rem", fontWeight: 700 }}>${pack.price.toLocaleString("en-US")}</span>
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: 12 }}>
                ${(pack.price / pack.credits).toFixed(2)}/credit
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: "100%" }}
                disabled={loading === pack.packId}
                onClick={async () => {
                  if (!isLoggedIn) { window.location.href = "/login?returnTo=/pricing"; return; }
                  if (currentPlan === "free") { setToast("⚠️ Top-ups are for paid plans only. Please upgrade first."); return; }
                  if (billingStatus === "cancelled") { setToast("⚠️ Your subscription is cancelled. Resubscribe first to buy top-ups."); return; }
                  setLoading(pack.packId);
                  try {
                    const res = await fetch("/api/razorpay/create-order", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ packId: pack.packId }),
                    });
                    const data = await res.json();
                    if (!res.ok) { setToast(data.error || "Failed to create order"); setLoading(null); return; }
                    const options = {
                      key: data.keyId,
                      order_id: data.orderId,
                      amount: data.amount,
                      currency: data.currency,
                      name: "Agentic Factor",
                      description: `${pack.name} — ${pack.credits} Credits`,
                      handler: function () {
                        setToast(`🎉 ${pack.credits} credits added to your account!`);
                        setTimeout(() => { fetchBilling(); }, 2000);
                      },
                      theme: { color: "#6366f1" },
                    };
                    const rzp = new (window as any).Razorpay(options);
                    rzp.open();
                  } catch {
                    setToast("Payment failed. Please try again.");
                  } finally {
                    setLoading(null);
                  }
                }}
              >
                {loading === pack.packId ? "Processing..." : "Buy Now"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ Section */}
      <div style={{ maxWidth: 700, margin: "var(--space-2xl) auto 0", padding: "0 var(--space-md)" }}>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 700, textAlign: "center", marginBottom: "var(--space-xl)" }}>Frequently Asked Questions</h2>
        {[
          { q: "What is a credit?", a: "Every agent action (LLM call, code execution, embedding) costs credits. Flash models cost 4 credits, Pro models cost 12, and premium models cost 20 per call." },
          { q: "Do unused credits roll over?", a: "No, credits reset monthly on your billing date. Use them or lose them!" },
          { q: "What are credit top-ups?", a: "When your monthly credits run out, you can buy top-up packs instantly. Top-up credits do NOT expire and are consumed after your monthly pool. Available for Individual & Pro plans only." },
          { q: "What happens when I run out of credits?", a: "Your running agents will pause. You can buy a top-up pack, wait for monthly refill, or upgrade your plan." },
          { q: "What's the difference between model tiers?", a: "Flash = fast & affordable (Gemini Flash, GPT-4o-mini, Claude 3.5 Haiku). Mixed = adds Pro models (Claude 3.5 Sonnet, Gemini Pro, GPT-4o). All = adds premium (Claude Sonnet 4 — best for code generation). Enterprise = bring your own fine-tuned models." },
          { q: "Can I change my plan anytime?", a: "Yes. Upgrade instantly, downgrade at end of billing cycle." },
          { q: "What payment methods are supported?", a: "Credit/debit cards, UPI, net banking, and wallets via Razorpay. International cards accepted." },
        ].map((faq, i) => (
          <div key={i} className="card" style={{ padding: "var(--space-md) var(--space-lg)", marginBottom: "var(--space-sm)" }}>
            <strong style={{ fontSize: "0.88rem" }}>{faq.q}</strong>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", margin: "var(--space-xs) 0 0", lineHeight: 1.6 }}>{faq.a}</p>
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center", marginTop: "var(--space-xl)" }}>
        <Link href="/dashboard" className="btn btn-ghost">← Back to Dashboard</Link>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "var(--bg-card)", border: "1px solid var(--border)", padding: "12px 20px", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", fontSize: "0.85rem", zIndex: 9999, animation: "slideIn 0.3s ease" }}>
          {toast}
        </div>
      )}
    </>
  );
}
