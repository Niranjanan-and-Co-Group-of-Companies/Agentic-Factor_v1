export const metadata = {
  title: "Privacy Policy — Agentic Factor",
  description: "How Agentic Factor collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <div className="welcome-section" style={{ maxWidth: 800 }}>
      <h1 className="welcome-section-title" style={{ textAlign: "left", fontSize: "1.5rem", marginBottom: 32 }}>🔒 Privacy Policy</h1>
      <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: 32 }}>Last updated: May 2026</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 28, fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.8 }}>
        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>1. Information We Collect</h2>
          <p><strong>Account Data:</strong> Email address, name, and profile picture (via Google/Zoho OAuth).</p>
          <p><strong>Mission Data:</strong> Mission descriptions, agent configurations, uploaded files (PDF, DOCX, TXT), and generated outputs.</p>
          <p><strong>Credential Data:</strong> OAuth tokens for third-party services (Google, Slack, GitHub, Zoho, etc.), encrypted with AES-256-GCM.</p>
          <p><strong>Usage Data:</strong> Credit consumption, API calls, agent execution logs, and session information.</p>
          <p><strong>Payment Data:</strong> Subscription plan and payment status. Payment card details are processed by Razorpay and never stored on our servers.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>2. How We Use Your Data</h2>
          <p>We use your data to: (a) provide and improve the Platform; (b) execute your missions and agent tasks; (c) process payments and manage subscriptions; (d) send transactional emails (OTP, mission notifications); (e) detect and prevent abuse or fraud; (f) generate anonymized analytics to improve the service.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>3. Data Storage & Security</h2>
          <p><strong>Database:</strong> All data is stored in Supabase (PostgreSQL) with Row Level Security (RLS) ensuring tenant isolation.</p>
          <p><strong>Encryption:</strong> Credentials are encrypted with AES-256-GCM using per-tenant derived keys. Data in transit is protected by TLS 1.3.</p>
          <p><strong>Code Execution:</strong> Agent code runs in isolated E2B sandboxes — no access to other tenants&apos; data or the host system.</p>
          <p><strong>Embeddings:</strong> Document content is vectorized using OpenAI embeddings and stored in pgvector. Original files are not retained after processing unless explicitly saved by the user.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>4. Third-Party Services</h2>
          <p>We integrate with the following services, each with their own privacy policies:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li><strong>Supabase</strong> — Database & authentication</li>
            <li><strong>OpenAI</strong> — LLM and embedding services</li>
            <li><strong>Google Gemini</strong> — LLM services</li>
            <li><strong>E2B</strong> — Sandboxed code execution</li>
            <li><strong>Razorpay</strong> — Payment processing</li>
            <li><strong>SMTP2GO</strong> — Transactional email delivery</li>
            <li><strong>Google, Slack, GitHub, Zoho, Notion, Discord</strong> — OAuth integrations</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>5. Your Rights</h2>
          <p>You have the right to: (a) access your data via the dashboard; (b) request deletion of your account and associated data; (c) export your mission data; (d) revoke OAuth permissions at any time via the Connectors page; (e) withdraw consent for data processing.</p>
          <p>To exercise any of these rights, contact us at <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a>.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>6. Data Retention</h2>
          <p>Active account data is retained indefinitely while your account is active. Upon account deletion, all data is permanently removed within 30 days. Anonymized usage analytics may be retained for service improvement.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>7. Cookies</h2>
          <p>We use essential cookies for authentication and session management. We do not use tracking cookies or third-party analytics cookies. No cookie consent banner is required as we only use strictly necessary cookies.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>8. Contact</h2>
          <p>For privacy-related questions or data requests, contact us at <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a>.</p>
        </section>
      </div>
    </div>
  );
}
