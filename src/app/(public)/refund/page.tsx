export const metadata = {
  title: "Refund Policy — Agentic Factor",
  description: "Agentic Factor refund and cancellation policy.",
};

export default function RefundPage() {
  return (
    <div className="welcome-section" style={{ maxWidth: 800 }}>
      <h1 className="welcome-section-title" style={{ textAlign: "left", fontSize: "1.5rem", marginBottom: 32 }}>💰 Refund & Cancellation Policy</h1>
      <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: 32 }}>Last updated: May 2026</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 28, fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.8 }}>
        <section style={{ background: "hsla(0,84%,60%,0.06)", border: "1px solid hsla(0,84%,60%,0.2)", borderRadius: 12, padding: 24 }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "hsl(0,84%,60%)", marginBottom: 8 }}>No Refund Policy</h2>
          <p><strong>All purchases on Agentic Factor are final and non-refundable.</strong> This includes subscription fees, credit purchases, and any one-time payments. We do not offer refunds under any circumstances.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Subscription Cancellation</h2>
          <p>You may cancel your subscription at any time from the Pricing page or by contacting support. When you cancel:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>Your access continues until the end of the current billing period.</li>
            <li>No further charges will be made after the current period ends.</li>
            <li>No refund is issued for the remaining days of the current period.</li>
            <li>Unused credits are <strong>forfeited</strong> upon cancellation.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Plan Downgrade</h2>
          <p>If you downgrade from a higher plan to a lower plan:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>The downgrade takes effect at the start of the next billing cycle.</li>
            <li>Excess credits above the new plan&apos;s pool are forfeited at the time of downgrade.</li>
            <li>No refund is issued for the price difference between plans.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Free Trial Credits</h2>
          <p>Free trial credits (30 credits) are provided as a one-time courtesy and are non-refundable, non-transferable, and cannot be exchanged for cash or applied to a paid plan.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Exceptions</h2>
          <p>In cases of technical errors on our end that prevent service delivery (e.g., system-wide outages lasting more than 24 hours), we may, at our sole discretion, issue credit extensions rather than monetary refunds.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Contact</h2>
          <p>For billing questions, contact us at <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a>.</p>
        </section>
      </div>
    </div>
  );
}
