"use client";
import { useState, useEffect, useCallback } from "react";

interface BillingData {
  plan: string;
  billing_status: string;
  credits_remaining: number;
  credits_topup: number;
  credits_total: number;
  credits_used_this_month: number;
  monthly_credit_limit: number | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  is_trial: boolean;
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free Trial", individual: "Individual", individual_annual: "Individual Annual",
  pro: "Pro", pro_annual: "Pro Annual", enterprise: "Enterprise",
};

const STATUS_COLORS: Record<string, string> = {
  active: "#10b981", trialing: "#10b981", past_due: "#f59e0b", halted: "#ef4444",
  cancelled: "#6b7280", cancellation_pending: "#f59e0b", pending: "#f59e0b",
  completed: "#6b7280",
};

const TOPUP_PACKS = [
  { id: "starter", name: "Starter Pack", credits: 200, price: "₹599" },
  { id: "power",   name: "Power Pack",   credits: 500, price: "₹1,299" },
  { id: "mega",    name: "Mega Pack",    credits: 1500, price: "₹3,499" },
];

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [capInput, setCapInput] = useState<string>("");
  const [savingCap, setSavingCap] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const [buyingPack, setBuyingPack] = useState<string | null>(null);

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchBilling = useCallback(async () => {
    const res = await fetch("/api/billing/usage", { credentials: "include" });
    if (res.ok) {
      const { billing: b } = await res.json() as { billing: BillingData };
      setBilling(b);
      setCapInput(b?.monthly_credit_limit != null ? String(b.monthly_credit_limit) : "");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchBilling(); }, [fetchBilling]);

  const saveCap = async () => {
    setSavingCap(true);
    const val = capInput.trim() === "" ? null : parseInt(capInput, 10);
    const res = await fetch("/api/billing/usage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ monthly_credit_limit: val }),
    });
    if (res.ok) { showToast("Spending cap saved."); await fetchBilling(); }
    else showToast("Failed to save cap.", "err");
    setSavingCap(false);
  };

  const cancelSubscription = async () => {
    setCancelling(true);
    const res = await fetch("/api/razorpay/cancel-subscription", {
      method: "POST", credentials: "include",
    });
    const data = await res.json() as { message?: string; error?: string };
    if (res.ok) {
      showToast(data.message ?? "Subscription cancellation scheduled.");
      setCancelConfirm(false);
      await fetchBilling();
    } else {
      showToast(data.error ?? "Failed to cancel.", "err");
    }
    setCancelling(false);
  };

  const buyTopup = async (packId: string) => {
    setBuyingPack(packId);
    const res = await fetch("/api/razorpay/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ packId }),
    });
    if (!res.ok) { showToast("Failed to create order.", "err"); setBuyingPack(null); return; }
    const { orderId, amount } = await res.json() as { orderId: string; amount: number };
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => {
      const rzp = new (window as any).Razorpay({
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        order_id: orderId, amount,
        currency: "INR",
        name: "Agentic Factor",
        description: TOPUP_PACKS.find(p => p.id === packId)?.name,
        handler: async () => {
          showToast("Payment successful! Credits are being added…");
          setTimeout(() => fetchBilling(), 5000);
        },
      });
      rzp.open();
    };
    document.body.appendChild(script);
    setBuyingPack(null);
  };

  const card: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: "var(--radius)", padding: "var(--space-lg)",
  };

  if (loading) return <div className="page-container" style={{ color: "var(--text-muted)" }}>Loading…</div>;

  const totalAvailable = (billing?.credits_remaining ?? 0) + (billing?.credits_topup ?? 0);
  const usedPct = billing?.credits_total ? Math.min(100, Math.round(((billing.credits_total - (billing.credits_remaining ?? 0)) / billing.credits_total) * 100)) : 0;
  const isPaidPlan = billing?.plan && !["free"].includes(billing.plan);
  const canCancel = isPaidPlan && !["cancelled", "completed", "cancellation_pending"].includes(billing?.billing_status ?? "");
  const statusColor = STATUS_COLORS[billing?.billing_status ?? ""] ?? "#6b7280";

  return (
    <div className="page-container stack" style={{ gap: "var(--space-lg)", maxWidth: 760 }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, padding: "10px 18px",
          background: toast.type === "ok" ? "var(--emerald)" : "#ef4444", color: "#fff",
          borderRadius: 8, fontWeight: 600, fontSize: "0.86rem", boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div>
        <div style={{ fontWeight: 700, fontSize: "1.5rem" }}>Billing & Credits</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: 4 }}>
          Manage your plan, credits, and spending limits.
        </div>
      </div>

      {/* Plan card */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>
              {PLAN_LABELS[billing?.plan ?? "free"] ?? billing?.plan ?? "Free"}
              {billing?.is_trial && <span style={{ marginLeft: 8, fontSize: "0.72rem", padding: "2px 8px", background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)", borderRadius: 10, fontWeight: 600 }}>Trial</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, display: "inline-block" }} />
              <span style={{ fontSize: "0.8rem", color: statusColor, textTransform: "capitalize" }}>
                {billing?.billing_status === "cancellation_pending" ? "Cancels at period end" : billing?.billing_status ?? "—"}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {!isPaidPlan && (
              <a href="/pricing" className="btn btn-primary btn-sm" style={{ textDecoration: "none", fontSize: "0.82rem" }}>
                Upgrade Plan →
              </a>
            )}
            {canCancel && !cancelConfirm && (
              <button className="btn btn-ghost btn-sm" style={{ fontSize: "0.82rem", color: "#ef4444" }}
                onClick={() => setCancelConfirm(true)}>
                Cancel Subscription
              </button>
            )}
          </div>
        </div>

        {/* Billing period */}
        {billing?.billing_period_start && (
          <div style={{ marginTop: 14, display: "flex", gap: 24, flexWrap: "wrap", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            <div>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>Period start: </span>
              {new Date(billing.billing_period_start).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
            </div>
            {billing.billing_period_end && (
              <div>
                <span style={{ fontWeight: 600, color: "var(--text)" }}>
                  {billing.billing_status === "cancellation_pending" ? "Access until: " : "Renews: "}
                </span>
                {new Date(billing.billing_period_end).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
              </div>
            )}
          </div>
        )}

        {/* Cancel confirmation */}
        {cancelConfirm && (
          <div style={{ marginTop: 16, padding: "14px 16px", background: "color-mix(in srgb, #ef4444 8%, transparent)", borderRadius: 8, border: "1px solid color-mix(in srgb, #ef4444 30%, transparent)" }}>
            <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: 8 }}>
              Cancel subscription?
            </div>
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 12 }}>
              You'll retain full access until the end of your current billing period. Your top-up credits are preserved.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm" style={{ background: "#ef4444", color: "#fff", border: "none" }}
                onClick={cancelSubscription} disabled={cancelling}>
                {cancelling ? "Cancelling…" : "Yes, cancel at period end"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setCancelConfirm(false)}>
                Keep my subscription
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Credits overview */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: "var(--space-md)" }}>Credits</div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
          {[
            { label: "Available now", value: totalAvailable.toLocaleString(), highlight: true },
            { label: "Monthly credits", value: (billing?.credits_remaining ?? 0).toLocaleString() },
            { label: "Top-up credits", value: (billing?.credits_topup ?? 0).toLocaleString() },
            { label: "Used this period", value: (billing?.credits_used_this_month ?? 0).toLocaleString() },
          ].map(({ label, value, highlight }) => (
            <div key={label}>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{label}</div>
              <div style={{ fontWeight: 700, fontSize: highlight ? "1.4rem" : "1rem", color: highlight ? "var(--accent)" : "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
            </div>
          ))}
        </div>

        {(billing?.credits_total ?? 0) > 0 && (
          <>
            <div style={{ height: 8, background: "var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 6 }}>
              <div style={{
                height: "100%", borderRadius: 8,
                background: usedPct > 85 ? "#ef4444" : usedPct > 60 ? "#f59e0b" : "var(--accent)",
                width: `${usedPct}%`, transition: "width 0.4s ease",
              }} />
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {usedPct}% of {(billing?.credits_total ?? 0).toLocaleString()} monthly credits used
            </div>
          </>
        )}
      </div>

      {/* Spending cap */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Monthly Spending Cap</div>
        <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 12 }}>
          Stop all AI actions when this many monthly credits are consumed. Leave blank for no cap. Top-up credits bypass this cap.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="number"
            min="1"
            placeholder="No cap"
            value={capInput}
            onChange={e => setCapInput(e.target.value)}
            style={{ width: 140, padding: "8px 12px", background: "var(--background)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: "0.9rem" }}
          />
          <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>credits / period</span>
          <button className="btn btn-primary btn-sm" onClick={saveCap} disabled={savingCap}>
            {savingCap ? "Saving…" : "Save"}
          </button>
          {billing?.monthly_credit_limit != null && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setCapInput(""); }}
              style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Clear cap
            </button>
          )}
        </div>
      </div>

      {/* Top-up packs */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Buy Top-Up Credits</div>
        <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 16 }}>
          One-time purchase. Credits never expire and survive subscription changes.
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {TOPUP_PACKS.map(pack => (
            <div key={pack.id} style={{
              flex: "1 1 180px", background: "var(--background)", border: "1px solid var(--border)",
              borderRadius: 10, padding: "16px 18px",
            }}>
              <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: 4 }}>{pack.name}</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--accent)", marginBottom: 2, fontVariantNumeric: "tabular-nums" }}>
                🪙 {pack.credits.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 12 }}>credits</div>
              <button className="btn btn-primary btn-sm" style={{ width: "100%", fontSize: "0.82rem" }}
                onClick={() => buyTopup(pack.id)}
                disabled={buyingPack === pack.id}>
                {buyingPack === pack.id ? "Opening…" : pack.price}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Upgrade CTA for free users */}
      {!isPaidPlan && (
        <div style={{ ...card, background: "color-mix(in srgb, var(--accent) 6%, transparent)", textAlign: "center", padding: "var(--space-xl)" }}>
          <div style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 8 }}>Unlock full power</div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginBottom: 20 }}>
            Individual from ₹2,499/mo · Pro from ₹2,999/seat/mo · Enterprise custom
          </div>
          <a href="/pricing" className="btn btn-primary" style={{ textDecoration: "none", padding: "12px 28px" }}>
            View Plans →
          </a>
        </div>
      )}
    </div>
  );
}
