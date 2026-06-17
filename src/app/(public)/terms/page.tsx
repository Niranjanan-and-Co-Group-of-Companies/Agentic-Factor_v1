export const metadata = {
  title: "Terms & Conditions — Agentic Factor",
  description: "Terms and conditions for using the Agentic Factor platform.",
};

export default function TermsPage() {
  return (
    <div className="welcome-section" style={{ maxWidth: 800 }}>
      <h1 className="welcome-section-title" style={{ textAlign: "left", fontSize: "1.5rem", marginBottom: 32 }}>📜 Terms &amp; Conditions</h1>
      <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: 32 }}>Last updated: June 2026</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 28, fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.8 }}>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>1. Acceptance of Terms</h2>
          <p>By accessing or using Agentic Factor (&ldquo;the Platform&rdquo;, &ldquo;AgenticFactor&rdquo;), operated by Agentic Factor (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;), you agree to be bound by these Terms &amp; Conditions (&ldquo;Terms&rdquo;). If you do not agree, you must not use the Platform. These Terms apply to all visitors, users, and customers.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>2. Description of Service</h2>
          <p>Agentic Factor is a SaaS platform that enables users to design, deploy, and manage autonomous AI agent teams. The Platform provides AI-powered mission planning, code execution in sandboxed E2B environments, third-party service integrations via OAuth, a credit-based billing model, and a suite of pre-built integrations with external APIs.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>3. User Accounts</h2>
          <p>You must provide accurate, current, and complete information during registration and keep it updated. You are responsible for maintaining the confidentiality of your account credentials. You must notify us immediately at <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a> of any unauthorised use of your account. We are not liable for any loss arising from your failure to comply with this obligation.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>4. Credit-Based Billing</h2>
          <p>The Platform operates on a credit-based consumption model. Each agent action (LLM inference, code execution, file processing, API calls) deducts credits from your pool. Free trial credits are non-transferable, non-refundable, and expire as stated at the time of issuance. Paid plan credits are replenished monthly upon successful payment. <strong>All sales are final — no refunds are issued under any circumstances except as required by applicable law.</strong></p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>5. No Refund Policy</h2>
          <p>All purchases, including subscription fees and top-up credit purchases, are <strong>non-refundable</strong>. Cancelling a subscription stops future billing but does not entitle you to a refund for the current billing period. Unused credits are forfeited upon account cancellation or plan downgrade. Nothing in this clause affects statutory rights you may have under applicable consumer protection law.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>6. Acceptable Use</h2>
          <p>You agree not to use the Platform to:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li>Violate any applicable local, national, or international law or regulation</li>
            <li>Bypass, circumvent, or disable any billing, rate-limiting, authentication, or security measure</li>
            <li>Upload or transmit malicious code, viruses, or harmful content</li>
            <li>Impersonate any person or entity or misrepresent your affiliation</li>
            <li>Send spam, unsolicited commercial communications, or bulk messages without consent</li>
            <li>Reverse-engineer, decompile, disassemble, or attempt to extract source code from any part of the Platform</li>
            <li>Scrape, crawl, or index any part of the Platform without express written permission</li>
            <li>Use agent outputs to harass, defame, or harm any individual or group</li>
            <li>Resell or sublicense access to the Platform without our written consent</li>
          </ul>
          <p style={{ marginTop: 8 }}>Violation of these conditions may result in immediate account suspension or termination.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>7. Intellectual Property</h2>
          <p>You retain full ownership of all content you provide to the Platform — including mission descriptions, uploaded files, and credentials. We retain ownership of the Platform itself, including its infrastructure, proprietary AI workflows, code, design, and documentation. Agent-generated outputs belong to you. We retain the right to use <strong>anonymised, non-personally-identifiable</strong> usage patterns to improve the Platform; we do not use your content or connected API data to train AI or machine learning models.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>8. Third-Party Integrations</h2>
          <p>The Platform connects to third-party services via OAuth and API keys, including but not limited to: Google (Gmail, Drive, Calendar, Sheets), Meta (Facebook, Instagram), LinkedIn, Twitter/X, Slack, GitHub, Notion, Discord, Zoho, Stripe, Razorpay, SendGrid, Twilio, Apollo.io, and Hunter.io. We are not responsible for the availability, accuracy, security, or content of third-party services. Your use of any third-party service is governed by that service&apos;s own terms and privacy policy. We do not make warranties of any kind regarding third-party services.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>9. Limitation of Liability</h2>
          <p>The Platform is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, either express or implied, including fitness for a particular purpose, merchantability, or non-infringement. To the maximum extent permitted by applicable law, we are not liable for any indirect, incidental, special, punitive, or consequential damages — including loss of profits, data, or business — arising from your use of or inability to use the Platform. Our total aggregate liability for any claim is limited to the greater of (a) the amount you have paid us in the 12 months preceding the claim or (b) INR 5,000.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>10. Account Termination</h2>
          <p>We reserve the right to suspend or terminate your account with immediate effect if you breach these Terms, engage in fraudulent activity, or use the Platform in a manner harmful to others or to us. Upon termination, your access to the Platform will cease immediately. Your data will be retained for 30 days from the date of termination, after which it will be permanently and irreversibly deleted. You may request voluntary account deletion at any time by contacting <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a>.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>11. Governing Law &amp; Jurisdiction</h2>
          <p>These Terms and any dispute or claim arising out of or in connection with them (including non-contractual disputes) are governed by and construed in accordance with the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts in <strong>Thrissur, Kerala, India</strong>.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>12. Modifications to Terms</h2>
          <p>We reserve the right to update these Terms at any time. Material changes will be communicated to your registered email address and displayed on the Platform at least 14 days before the change takes effect. Continued use of the Platform after the effective date constitutes acceptance of the revised Terms. If you do not agree to the revised Terms, you must stop using the Platform and may request account deletion.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>13. Contact &amp; Registered Address</h2>
          <p>For questions about these Terms or any legal matter, contact us at:</p>
          <address style={{ fontStyle: "normal", marginTop: 8, paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>
            <strong>Agentic Factor</strong><br />
            Thrissur, Kerala, India — 680 001<br />
            Email: <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a>
          </address>
        </section>

      </div>
    </div>
  );
}
