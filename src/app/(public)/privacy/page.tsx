export const metadata = {
  title: "Privacy Policy — Agentic Factor",
  description: "How Agentic Factor collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <div className="welcome-section" style={{ maxWidth: 800 }}>
      <h1 className="welcome-section-title" style={{ textAlign: "left", fontSize: "1.5rem", marginBottom: 32 }}>🔒 Privacy Policy</h1>
      <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: 32 }}>Last updated: June 2026</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 28, fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.8 }}>

        {/* ── MANDATORY GOOGLE STATEMENT ── */}
        <section style={{ background: "hsla(217,91%,60%,0.06)", border: "1px solid hsla(217,91%,60%,0.2)", borderRadius: 10, padding: "16px 20px" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Google API Services — Limited Use Disclosure</h2>
          <p>
            AgenticFactor&apos;s use and transfer of information received from Google APIs adheres to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <p style={{ marginTop: 8 }}>
            Information received from Google APIs is used exclusively to fulfil the specific agent task that the user explicitly configured and initiated within their account. This data is accessed on-demand within an isolated, sandboxed execution environment and is not stored beyond what is needed to complete that task, unless the user explicitly saves an output to their account.
          </p>
        </section>

        {/* ── AI TRAINING DISCLAIMER ── */}
        <section style={{ background: "hsla(142,71%,45%,0.06)", border: "1px solid hsla(142,71%,45%,0.2)", borderRadius: 10, padding: "16px 20px" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>AI Training — Strict Prohibition</h2>
          <p>
            <strong>We never use your data to train, fine-tune, or develop AI models.</strong> Data fetched from Google (Gmail, Drive, Calendar, Sheets), Meta (Facebook, Instagram), LinkedIn, Twitter/X, Slack, or any other connected third-party service is used solely as execution context within the user&apos;s tenant-isolated sandboxed agents at the time of task execution. This data is never retained for, or transferred to, any AI model training pipeline — including Anthropic Claude, OpenAI, or Google Gemini. Third-party LLM providers receive only the minimum prompt context required to generate code or reasoning for the specific agent step; they do not receive raw personal data from your connected accounts unless you explicitly include it in your mission description.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>1. Who We Are</h2>
          <p>
            Agentic Factor (&ldquo;AgenticFactor&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is a SaaS platform that enables businesses and individuals to build and run autonomous AI agent teams. Our registered business address is:
          </p>
          <address style={{ fontStyle: "normal", marginTop: 8, paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>
            Agentic Factor<br />
            Thrissur, Kerala, India — 680 001<br />
            Email: <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a>
          </address>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>2. Information We Collect</h2>
          <p><strong>Account Data:</strong> Email address, name, and profile picture collected when you sign up via Google or Zoho OAuth.</p>
          <p><strong>Mission Data:</strong> Mission descriptions, agent configurations, uploaded files (PDF, DOCX, TXT), discovery question responses, and agent-generated outputs that you explicitly save.</p>
          <p><strong>Credential Data:</strong> OAuth access tokens and refresh tokens for third-party services you connect (e.g., Google, Slack, LinkedIn), and API keys you supply for services such as Stripe or SendGrid. All tokens and keys are encrypted at rest using AES-256-GCM with per-tenant derived keys and are never logged or transmitted in plaintext.</p>
          <p><strong>Usage Data:</strong> Credit consumption, API call counts, agent execution logs (stdout/stderr from sandboxed environments), and session information.</p>
          <p><strong>Payment Data:</strong> Subscription plan and payment status. Payment card details are processed exclusively by Razorpay under their PCI-DSS compliance and are never stored on our servers.</p>
          <p><strong>Third-Party API Data (Limited Use):</strong> When your agents execute tasks, they may transiently access data from your connected accounts (e.g., email threads from Gmail, calendar events, LinkedIn profile information). This data is processed only within isolated E2B sandboxes during the task run and is not retained after the task completes unless you explicitly save the agent&apos;s output.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>3. How We Use Your Data</h2>
          <p>We use your data strictly to:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li>Provide, operate, and improve the Platform and its features</li>
            <li>Execute the specific autonomous agent missions you configure and initiate</li>
            <li>Process payments and manage your subscription and credit balance</li>
            <li>Send transactional emails (mission notifications, OTP, billing receipts)</li>
            <li>Detect, investigate, and prevent abuse, fraud, or security incidents</li>
            <li>Generate anonymised, aggregated analytics to improve service reliability</li>
            <li>Respond to your support requests and legal obligations</li>
          </ul>
          <p style={{ marginTop: 8 }}>
            We do <strong>not</strong> use your data for: advertising, selling data to third parties, behavioural profiling, or AI/ML model training of any kind.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>4. Specific Use of Third-Party API Data</h2>
          <p>For each connected integration, data accessed via their APIs is used <strong>only</strong> for the purpose described:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li><strong>Google (Gmail, Drive, Calendar, Sheets):</strong> Read/write emails, files, events, or spreadsheet data as explicitly instructed by the user&apos;s configured agent task. Access is scoped to the minimum permissions required for the specific task.</li>
            <li><strong>Meta — Facebook &amp; Instagram:</strong> Post content to Pages or Business accounts, and read basic page metrics, as directed by the user&apos;s mission. We do not access personal Facebook profiles beyond what the Page management permission provides.</li>
            <li><strong>LinkedIn:</strong> Read the authenticated user&apos;s profile (name, sub/URN) and post content to their feed or company page as instructed by the user&apos;s mission. We do not access connection lists, messages, or analytics beyond what is required for the task.</li>
            <li><strong>Twitter / X:</strong> Post tweets or read recent tweets as instructed by the user&apos;s mission. We access only the scopes granted during OAuth authorisation.</li>
            <li><strong>Slack:</strong> Send messages to channels or read channel history as directed by the user&apos;s mission. We access only the channels and scopes the user explicitly authorises.</li>
            <li><strong>GitHub:</strong> Create issues, read repositories, or interact with the GitHub API as directed by the user&apos;s mission.</li>
            <li><strong>Notion:</strong> Create or read pages and databases as directed by the user&apos;s mission.</li>
            <li><strong>Zoho:</strong> Used for account authentication and OAuth login.</li>
            <li><strong>Discord:</strong> Send messages to servers as directed by the user&apos;s mission.</li>
            <li><strong>Stripe:</strong> Payment processing for Platform subscriptions; Stripe handles all card data directly.</li>
            <li><strong>Razorpay:</strong> Payment processing for Indian customers; Razorpay handles all card data directly.</li>
            <li><strong>SendGrid:</strong> Delivery of transactional emails (mission notifications, OTP) on behalf of the Platform. No user personal data is shared with SendGrid beyond the recipient email address and message content.</li>
            <li><strong>Twilio:</strong> SMS or voice notification delivery if configured by the user&apos;s mission.</li>
            <li><strong>Apollo.io:</strong> Lead enrichment and contact lookup if used within a user&apos;s mission. Data accessed is limited to publicly available business contact information.</li>
            <li><strong>Hunter.io:</strong> Email address lookup and verification if used within a user&apos;s mission.</li>
            <li><strong>OpenAI / Anthropic Claude / Google Gemini:</strong> LLM API calls for code generation and reasoning within agent steps. Only the minimum prompt context needed for the specific task is sent. No raw personal data from connected accounts is sent to LLM providers.</li>
            <li><strong>E2B:</strong> Sandboxed Python execution environments for running agent code. Sandboxes are ephemeral and destroyed after each task.</li>
            <li><strong>Supabase (Inngest):</strong> Background job orchestration and database hosting.</li>
            <li><strong>SMTP2GO:</strong> Outbound email delivery for certain notification types.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>5. Data Storage &amp; Security</h2>
          <p><strong>Database:</strong> All data is stored in Supabase (PostgreSQL) hosted on AWS, with Row Level Security (RLS) ensuring complete tenant isolation — no tenant can access another&apos;s data.</p>
          <p><strong>Credential Encryption:</strong> OAuth tokens and API keys are encrypted with AES-256-GCM using per-tenant derived keys before storage. Keys are never logged.</p>
          <p><strong>Data in Transit:</strong> All communications between your browser, our servers, and third-party APIs are protected by TLS 1.3.</p>
          <p><strong>Code Execution Isolation:</strong> Agent code runs in ephemeral E2B sandboxes — isolated containers with no filesystem or network access beyond what the task requires and no access to other tenants&apos; data or the host system. Sandboxes are destroyed after each agent step completes.</p>
          <p><strong>Embeddings:</strong> If you use the knowledge-base feature, document content is vectorised using OpenAI embeddings and stored in pgvector. Original uploaded files are not retained after processing unless explicitly saved by you.</p>
          <p><strong>Access Controls:</strong> Production database and infrastructure access is restricted to authorised personnel only and is protected by MFA.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>6. Meta Platform Data — Deletion Instructions</h2>
          <p>
            If you have connected a Facebook Page or Instagram Business account to AgenticFactor and wish to request deletion of all associated data held by AgenticFactor (OAuth tokens, stored outputs related to your Meta account), you may do so in either of the following ways:
          </p>
          <ol style={{ paddingLeft: 20, marginTop: 8 }}>
            <li>
              <strong>Self-serve (Instant):</strong> Log in to your AgenticFactor account → go to <strong>Connectors</strong> → locate the Facebook or Instagram connector → click <strong>&ldquo;Disconnect&rdquo;</strong>. This immediately revokes our stored access token and removes all associated credential data from our database.
            </li>
            <li style={{ marginTop: 8 }}>
              <strong>Email Request:</strong> Send an email to <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a> with the subject line <em>&ldquo;Meta Data Deletion Request&rdquo;</em> and your registered email address. We will confirm deletion within 72 hours and purge all associated data within 30 days.
            </li>
          </ol>
          <p style={{ marginTop: 8 }}>
            We do not retain Facebook or Instagram user data after disconnection. Mission output data (e.g., post IDs returned by the Facebook API) is deleted along with your mission data upon account deletion.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>7. Your Rights &amp; Data Control</h2>
          <p>You have the following rights over your data:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li><strong>Access:</strong> View all your mission data, connected integrations, and usage history from your account dashboard.</li>
            <li><strong>Correction:</strong> Update your profile information at any time via account settings.</li>
            <li><strong>Deletion:</strong> Request full account and data deletion by emailing <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a>. All data is permanently purged within 30 days.</li>
            <li><strong>Portability:</strong> Export your mission data and outputs in JSON format from the dashboard.</li>
            <li><strong>Revoke OAuth Access:</strong> Disconnect any connected service at any time from the Connectors page. This immediately invalidates our stored access token for that service.</li>
            <li><strong>Withdrawal of Consent:</strong> You may withdraw consent for data processing at any time by deleting your account.</li>
            <li><strong>GDPR Rights (EU/EEA Users):</strong> If you are located in the EU or EEA, you additionally have the right to lodge a complaint with your local Data Protection Authority and to object to or restrict processing in certain circumstances. Our lawful basis for processing your data is: (a) contract performance — to provide the services you requested; (b) legitimate interests — for security and fraud prevention; (c) consent — for optional communications.</li>
          </ul>
          <p style={{ marginTop: 8 }}>To exercise any of these rights, contact us at <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a>.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>8. Data Sharing &amp; Disclosure</h2>
          <p>We do not sell, rent, or trade your personal data. We share data only in the following limited circumstances:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li><strong>Service Providers:</strong> Third-party vendors listed in Section 4 who process data on our behalf under data processing agreements.</li>
            <li><strong>Legal Requirements:</strong> If required by applicable law, court order, or government authority.</li>
            <li><strong>Business Transfer:</strong> In the event of a merger, acquisition, or sale of assets, user data may be transferred. You will be notified in advance.</li>
            <li><strong>Safety:</strong> To protect the rights, property, or safety of AgenticFactor, our users, or the public.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>9. Data Retention</h2>
          <p>Active account data (missions, agent configurations, outputs) is retained while your account is active. OAuth tokens for connected services are retained until you disconnect the service. Upon account deletion, all personal data is permanently removed within 30 days. Anonymised, aggregated usage metrics (no personal identifiers) may be retained indefinitely for service improvement.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>10. Cookies</h2>
          <p>We use only strictly necessary cookies for authentication (Supabase session token) and CSRF protection. We do not use advertising cookies, tracking pixels, or third-party analytics cookies. No cookie consent banner is required as only essential cookies are used.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>11. Children&apos;s Privacy</h2>
          <p>The Platform is intended for users aged 18 and above. We do not knowingly collect personal data from children under 13. If we become aware of such collection, we will delete it immediately.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>12. Changes to This Policy</h2>
          <p>We may update this Privacy Policy from time to time. Material changes will be communicated by email to your registered address and by a notice on the Platform at least 14 days before the change takes effect. Continued use of the Platform after that date constitutes acceptance of the updated policy.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>13. Governing Law</h2>
          <p>This Privacy Policy is governed by the laws of India. Any disputes arising under this policy shall be subject to the exclusive jurisdiction of the courts in Thrissur, Kerala, India.</p>
        </section>

        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>14. Contact &amp; Registered Address</h2>
          <p>For privacy-related questions, data requests, or to exercise any of your rights:</p>
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
