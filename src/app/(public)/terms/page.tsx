export const metadata = {
  title: "Terms & Conditions — Agentic Factor",
  description: "Terms and conditions for using the Agentic Factor platform.",
};

export default function TermsPage() {
  return (
    <div className="welcome-section" style={{ maxWidth: 800 }}>
      <h1 className="welcome-section-title" style={{ textAlign: "left", fontSize: "1.5rem", marginBottom: 32 }}>📜 Terms & Conditions</h1>
      <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: 32 }}>Last updated: May 2026</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 28, fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.8 }}>
        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>1. Acceptance of Terms</h2>
          <p>By accessing or using Agentic Factor (&ldquo;the Platform&rdquo;), operated by Agentic Factor (&ldquo;we&rdquo;, &ldquo;us&rdquo;), you agree to be bound by these Terms & Conditions. If you do not agree, do not use the Platform.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>2. Description of Service</h2>
          <p>Agentic Factor is a SaaS platform that enables users to design, deploy, and manage autonomous AI agent teams. The Platform provides AI-powered mission planning, code execution in sandboxed environments, third-party service integrations via OAuth, and credit-based billing.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>3. User Accounts</h2>
          <p>You must provide accurate, current, and complete information during registration. You are responsible for maintaining the confidentiality of your account credentials. You must notify us immediately of any unauthorized use of your account.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>4. Credit-Based Billing</h2>
          <p>The Platform operates on a credit-based consumption model. Each agent action (LLM calls, code execution, file processing) deducts credits from your pool. Free trial credits are non-refundable and expire if unused. Paid plan credits are replenished monthly upon successful payment. <strong>All sales are final — no refunds are issued under any circumstances.</strong></p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>5. No Refund Policy</h2>
          <p>All purchases, including subscription fees and credit purchases, are <strong>non-refundable</strong>. Cancelling a subscription stops future billing but does not entitle you to a refund for the current billing period. Unused credits are forfeited upon account cancellation or downgrade.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>6. Acceptable Use</h2>
          <p>You agree not to: (a) use the Platform for illegal activities; (b) attempt to bypass billing, rate limits, or security measures; (c) upload malicious code or content; (d) impersonate other users or entities; (e) use the Platform to send spam or unsolicited communications; (f) reverse-engineer or decompile any part of the Platform.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>7. Intellectual Property</h2>
          <p>You retain ownership of all content you provide to the Platform (mission descriptions, uploaded files, credentials). We retain ownership of the Platform, including its AI models, code, design, and documentation. Agent-generated outputs belong to you, but we retain the right to use anonymized usage data to improve the Platform.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>8. Third-Party Integrations</h2>
          <p>The Platform connects to third-party services (Google, Slack, GitHub, Zoho, etc.) via OAuth. We are not responsible for the availability, accuracy, or security of third-party services. Your use of third-party services is governed by their respective terms.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>9. Limitation of Liability</h2>
          <p>The Platform is provided &ldquo;as is&rdquo; without warranties of any kind. We are not liable for any indirect, incidental, special, or consequential damages arising from your use of the Platform. Our total liability is limited to the amount you have paid us in the 12 months preceding the claim.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>10. Account Termination</h2>
          <p>We reserve the right to suspend or terminate your account if you violate these Terms. Upon termination, your data will be retained for 30 days, after which it will be permanently deleted. You may request account deletion by contacting support.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>11. Governing Law</h2>
          <p>These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts in Bangalore, Karnataka, India.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>12. Contact</h2>
          <p>For questions about these Terms, contact us at <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a>.</p>
        </section>
      </div>
    </div>
  );
}
