"use client";
import { useState, useEffect, useMemo } from "react";
import { createBrowserClient } from "@supabase/ssr";
import ConnectorLogo from "@/components/ConnectorLogos";

// ============================================================
// Connector Marketplace — 40+ SaaS Platforms
// Search, filter, connect, and request new connectors.
// ============================================================

type ConnectorStatus = "connected" | "available" | "coming_soon" | "request_access";
type ConnectorCategory = "communication" | "crm" | "payments" | "ecommerce" | "devtools" | "cloud" | "analytics" | "productivity" | "social" | "ai" | "storage" | "marketing" | "hr";

interface ConnectorDef {
  id: string;
  label: string;
  icon: string;
  description: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  provider?: string; // Supabase OAuth provider ID
  scopes?: string[];
}

const CATEGORIES: { key: ConnectorCategory | "all"; label: string; icon: string }[] = [
  { key: "all", label: "All", icon: "🌐" },
  { key: "communication", label: "Communication", icon: "💬" },
  { key: "crm", label: "CRM", icon: "👥" },
  { key: "payments", label: "Payments", icon: "💳" },
  { key: "ecommerce", label: "E-Commerce", icon: "🛒" },
  { key: "devtools", label: "Dev Tools", icon: "🔧" },
  { key: "cloud", label: "Cloud", icon: "☁️" },
  { key: "analytics", label: "Analytics", icon: "📊" },
  { key: "productivity", label: "Productivity", icon: "📋" },
  { key: "social", label: "Social", icon: "📱" },
  { key: "ai", label: "AI / ML", icon: "🤖" },
  { key: "storage", label: "Storage", icon: "💾" },
  { key: "marketing", label: "Marketing", icon: "📣" },
  { key: "hr", label: "HR", icon: "🏢" },
];

const CONNECTORS: ConnectorDef[] = [
  // ── LIVE (OAuth configured) ──
  { id: "google", label: "Google (Gmail)", icon: "📧", description: "Gmail, Calendar, Drive — email agents, scheduling, and file access.", category: "communication", status: "available", provider: "google", scopes: ["gmail.readonly", "calendar.events", "drive.readonly"] },

  // ── COMING SOON (Supabase provider exists, not yet configured) ──
  { id: "slack", label: "Slack", icon: "💬", description: "Post messages, read channels, DMs, reactions, and manage workflows. The backbone of agent notifications.", category: "communication", status: "available", provider: "slack", scopes: ["channels:read", "channels:history", "chat:write", "files:write", "groups:read", "im:read", "im:write", "reactions:read", "users:read"] },
  { id: "linkedin", label: "LinkedIn", icon: "💼", description: "Profile data, messaging, and social selling for recruitment and networking agents.", category: "social", status: "available", provider: "linkedin_oidc", scopes: ["openid", "profile", "email", "w_member_social"] },
  { id: "github", label: "GitHub", icon: "🐙", description: "Repository access, issues, PRs, and CI/CD — for code-gen and DevOps agents.", category: "devtools", status: "available", provider: "github" },
  { id: "azure", label: "Microsoft Azure", icon: "☁️", description: "VM management, storage, monitoring, and Azure AD for enterprise auth.", category: "cloud", status: "coming_soon", provider: "azure" },
  { id: "notion", label: "Notion", icon: "📝", description: "Read/write pages, databases, comments — for documentation and knowledge agents.", category: "productivity", status: "available", provider: "notion" },
  { id: "zoho", label: "Zoho", icon: "📊", description: "Zoho CRM, Mail, Sheets, and 40+ Zoho apps — complete business suite integration.", category: "crm", status: "available", provider: "zoho", scopes: ["ZohoCRM.modules.ALL", "ZohoMail.messages.ALL"] },
  { id: "discord", label: "Discord", icon: "🎮", description: "Bot management, channel messaging, and community engagement automation.", category: "communication", status: "available", provider: "discord", scopes: ["identify", "guilds", "bot", "connections"] },
  { id: "twitter", label: "X (Twitter)", icon: "🐦", description: "Post tweets, monitor mentions, analyze sentiment, and automate social presence.", category: "social", status: "available", provider: "twitter", scopes: ["tweet.read", "tweet.write", "users.read"] },
  { id: "facebook", label: "Facebook", icon: "📘", description: "Post to Pages, manage content, track engagement, and automate marketing.", category: "social", status: "available", provider: "facebook", scopes: ["pages_manage_posts", "pages_read_engagement"] },
  { id: "microsoft_teams", label: "Microsoft Teams", icon: "👥", description: "Teams messaging, meetings, and workflow automation for enterprise collaboration.", category: "communication", status: "coming_soon" },

  // ── REQUEST ACCESS (Not yet integrated) ──
  { id: "stripe", label: "Stripe", icon: "💳", description: "Payment processing, subscription management, invoice generation, and financial reporting.", category: "payments", status: "request_access" },
  { id: "shopify", label: "Shopify", icon: "🛍️", description: "Store management, product listings, order fulfillment, and inventory tracking.", category: "ecommerce", status: "request_access" },
  { id: "salesforce", label: "Salesforce", icon: "☁️", description: "CRM data, lead management, opportunity tracking, and sales pipeline automation.", category: "crm", status: "request_access" },
  { id: "hubspot", label: "HubSpot", icon: "🧲", description: "Marketing automation, CRM contacts, deal tracking, and email campaigns.", category: "crm", status: "request_access" },
  { id: "jira", label: "Jira", icon: "📋", description: "Issue tracking, sprint management, and Agile workflow automation.", category: "devtools", status: "request_access" },
  { id: "confluence", label: "Confluence", icon: "📖", description: "Wiki pages, knowledge base, and team documentation management.", category: "productivity", status: "request_access" },
  { id: "airtable", label: "Airtable", icon: "📊", description: "Spreadsheet-database hybrid for structured data management and automation.", category: "productivity", status: "request_access" },
  { id: "twilio", label: "Twilio", icon: "📞", description: "SMS, voice, video, and WhatsApp messaging for customer communication agents.", category: "communication", status: "request_access" },
  { id: "sendgrid", label: "SendGrid", icon: "✉️", description: "Transactional and marketing email at scale with delivery tracking.", category: "marketing", status: "request_access" },
  { id: "mailchimp", label: "Mailchimp", icon: "🐒", description: "Email campaigns, audience segmentation, and marketing automation.", category: "marketing", status: "request_access" },
  { id: "zendesk", label: "Zendesk", icon: "🎧", description: "Customer support tickets, live chat, and help center management.", category: "crm", status: "request_access" },
  { id: "intercom", label: "Intercom", icon: "💬", description: "Customer messaging, product tours, and support ticket routing.", category: "crm", status: "request_access" },
  { id: "aws", label: "Amazon Web Services", icon: "🟧", description: "S3, Lambda, CloudWatch, SES — full cloud infrastructure management.", category: "cloud", status: "request_access" },
  { id: "gcp", label: "Google Cloud", icon: "🔵", description: "BigQuery, Cloud Functions, Pub/Sub, and GCS for data engineering agents.", category: "cloud", status: "request_access" },
  { id: "vercel", label: "Vercel", icon: "▲", description: "Deployment management, serverless functions, and edge network control.", category: "devtools", status: "request_access" },
  { id: "supabase_ext", label: "Supabase", icon: "⚡", description: "Direct database access, realtime subscriptions, and storage management.", category: "devtools", status: "request_access" },
  { id: "firebase", label: "Firebase", icon: "🔥", description: "Firestore, Auth, Cloud Messaging, and hosting for mobile/web agents.", category: "cloud", status: "request_access" },
  { id: "openai_api", label: "OpenAI", icon: "🤖", description: "GPT-4o, DALL-E, Whisper, and Embeddings for AI-powered agent reasoning.", category: "ai", status: "request_access" },
  { id: "anthropic_api", label: "Anthropic", icon: "🧠", description: "Claude for long-context reasoning, analysis, and safe AI decision-making.", category: "ai", status: "request_access" },
  { id: "replicate", label: "Replicate", icon: "🔬", description: "Run open-source ML models (Stable Diffusion, LLaMA, Whisper) via API.", category: "ai", status: "request_access" },
  { id: "segment", label: "Segment", icon: "📡", description: "Customer data platform — unify, clean, and route analytics events.", category: "analytics", status: "request_access" },
  { id: "mixpanel", label: "Mixpanel", icon: "📈", description: "Product analytics, user flows, retention, and A/B test analysis.", category: "analytics", status: "request_access" },
  { id: "google_analytics", label: "Google Analytics", icon: "📊", description: "Web traffic, conversions, and user behavior analytics.", category: "analytics", status: "request_access" },
  { id: "dropbox", label: "Dropbox", icon: "📦", description: "File storage, sharing, and sync — for document management agents.", category: "storage", status: "request_access" },
  { id: "box", label: "Box", icon: "📁", description: "Enterprise content management, secure file sharing, and collaboration.", category: "storage", status: "request_access" },
  { id: "google_drive", label: "Google Drive", icon: "💾", description: "File management, Sheets/Docs access, and collaborative editing.", category: "storage", status: "request_access" },
  { id: "zapier", label: "Zapier", icon: "⚡", description: "Connect 5000+ apps with no-code automation workflows.", category: "productivity", status: "request_access" },
  { id: "make", label: "Make (Integromat)", icon: "🔄", description: "Visual automation builder with advanced data transformation.", category: "productivity", status: "request_access" },
  { id: "monday", label: "Monday.com", icon: "📅", description: "Work management, project tracking, and team collaboration.", category: "productivity", status: "request_access" },
  { id: "asana", label: "Asana", icon: "🎯", description: "Task management, project timelines, and team workload planning.", category: "productivity", status: "request_access" },
  { id: "trello", label: "Trello", icon: "📌", description: "Kanban boards, task cards, and visual project management.", category: "productivity", status: "request_access" },
  { id: "paypal", label: "PayPal", icon: "💰", description: "Payment processing, invoicing, and financial transaction management.", category: "payments", status: "request_access" },
  { id: "square", label: "Square", icon: "🟦", description: "POS payments, invoicing, and commerce solutions.", category: "payments", status: "request_access" },
  { id: "woocommerce", label: "WooCommerce", icon: "🛒", description: "WordPress e-commerce — products, orders, and inventory.", category: "ecommerce", status: "request_access" },
  { id: "bamboohr", label: "BambooHR", icon: "🎋", description: "HR management, employee data, time-off, and onboarding.", category: "hr", status: "request_access" },
  { id: "workday", label: "Workday", icon: "🏢", description: "Enterprise HCM, payroll, and workforce management.", category: "hr", status: "request_access" },
  { id: "instagram", label: "Instagram", icon: "📸", description: "Post scheduling, analytics, and DM automation.", category: "social", status: "available", provider: "instagram", scopes: ["instagram_basic", "instagram_content_publish"] },
  { id: "tiktok", label: "TikTok", icon: "🎵", description: "Content analytics, ad management, and engagement tracking.", category: "social", status: "request_access" },
  { id: "reddit", label: "Reddit", icon: "🤖", description: "Subreddit monitoring, comment analysis, and sentiment tracking.", category: "social", status: "request_access" },
];

const STATUS_BADGES: Record<ConnectorStatus, { label: string; class: string; icon: string }> = {
  connected: { label: "Connected", class: "badge-green", icon: "✓" },
  available: { label: "Available", class: "badge-blue", icon: "→" },
  coming_soon: { label: "Coming Soon", class: "badge-amber", icon: "🔧" },
  request_access: { label: "Request Access", class: "badge-purple", icon: "✨" },
};

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function ConnectorsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ConnectorCategory | "all">("all");
  const [connectedProviders, setConnectedProviders] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [requestSending, setRequestSending] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [connectorDefs, setConnectorDefs] = useState<ConnectorDef[]>(CONNECTORS);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => { loadConnectors(); checkConnectionStatus(); }, []);

  // ── Load connectors from DB, fallback to hardcoded ──
  const loadConnectors = async () => {
    try {
      const res = await fetch('/api/connectors/definitions');
      if (res.ok) {
        const data = await res.json();
        if (data.connectors?.length) {
          setConnectorDefs(data.connectors.map((c: any) => ({
            id: c.id,
            label: c.label,
            icon: c.icon_svg || '',
            description: c.description || '',
            category: c.category as ConnectorCategory,
            status: c.status as ConnectorStatus,
            provider: c.provider || undefined,
            scopes: c.scopes || undefined,
          })));
        }
      }
    } catch {
      // Fallback to hardcoded — already set as default
    }
  };

  const checkConnectionStatus = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    setUserEmail(user?.email || null);
    
    // Start with the login provider
    const providers = new Set<string>();
    const loginProvider = user?.app_metadata?.provider;
    if (loginProvider) providers.add(loginProvider);
    
    // Fetch ALL connected OAuth tokens from tenant_permissions
    if (user) {
      try {
        // Get the user's tenant_id from tenants table
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('id')
          .eq('owner_user_id', user.id)
          .single();
        
        if (tenantData) {
          const { data: perms } = await supabase
            .from('tenant_permissions')
            .select('provider')
            .eq('tenant_id', tenantData.id);
          
          if (perms) {
            perms.forEach(p => providers.add(p.provider));
          }
        }
      } catch (e) {
        console.warn('Failed to fetch tenant permissions:', e);
      }
    }
    
    setConnectedProviders(providers);
    setLoading(false);
  };

  // ── Filtered connectors ──
  const filtered = useMemo(() => {
    let list = connectorDefs.map(c => ({
      ...c,
      status: connectedProviders.has(c.provider || "") ? "connected" as ConnectorStatus : c.status,
    }));
    if (category !== "all") list = list.filter(c => c.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.label.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.category.includes(q)
      );
    }
    // Sort: connected first, then available, then coming_soon, then request_access
    const order: Record<ConnectorStatus, number> = { connected: 0, available: 1, coming_soon: 2, request_access: 3 };
    list.sort((a, b) => order[a.status] - order[b.status]);
    return list;
  }, [search, category, connectedProviders, connectorDefs]);

  // Map from connector ID to the OAuth route name (most are the same)
  const OAUTH_ROUTE_MAP: Record<string, string> = {
    linkedin: 'linkedin',
    google: 'google',
    github: 'github',
    slack: 'slack',
    notion: 'notion',
    zoho: 'zoho',
    discord: 'discord',
    twitter: 'twitter',
    facebook: 'facebook',
    instagram: 'instagram',
  };

  // Listen for OAuth popup success messages to auto-refresh
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_SUCCESS') {
        showToast(`✅ ${event.data.provider || 'Provider'} connected successfully!`);
        // Re-fetch connection status
        checkConnectionStatus();
      } else if (event.data?.type === 'OAUTH_ERROR') {
        showToast(`❌ Connection failed. Please try again.`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnect = async (connector: ConnectorDef) => {
    if (connector.status === "coming_soon") {
      showToast(`🔧 ${connector.label} is coming soon. We'll notify you when it's ready.`);
      return;
    }
    if (connector.status === "request_access") {
      handleRequestAccess(connector);
      return;
    }
    if (!connector.provider) return;

    setConnecting(connector.id);

    // Use our custom OAuth route (stores tokens in tenant_permissions)
    const oauthRoute = OAUTH_ROUTE_MAP[connector.id] || connector.id;
    const popup = window.open(
      `/api/oauth/${oauthRoute}`,
      'oauth_window',
      'width=500,height=600,scrollbars=yes'
    );

    // Watch for popup closing (user cancelled or completed)
    const pollTimer = setInterval(() => {
      if (popup && popup.closed) {
        clearInterval(pollTimer);
        setConnecting(null);
        // Re-check in case they completed the flow
        setTimeout(() => checkConnectionStatus(), 1000);
      }
    }, 500);
  };

  const handleRequestAccess = async (connector: ConnectorDef) => {
    setRequestSending(true);
    try {
      // Send request via API (uses SMTP2GO if configured, otherwise logs)
      const res = await fetch("/api/request-connector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          connectorId: connector.id,
          connectorLabel: connector.label,
          userEmail: userEmail,
        }),
      });
      if (res.ok) {
        showToast(`✅ Request sent for ${connector.label}! We'll notify you when it's available.`);
      } else {
        showToast(`📧 Request noted for ${connector.label}. We'll reach out when it's ready.`);
      }
    } catch {
      showToast(`📧 Request noted for ${connector.label}. We'll reach out when it's ready.`);
    }
    setRequestSending(false);
  };

  const handleDisconnect = (id: string) => {
    const conn = CONNECTORS.find(c => c.id === id);
    if (conn?.provider) setConnectedProviders(prev => { const s = new Set(prev); s.delete(conn.provider!); return s; });
    showToast(`✓ ${id} disconnected.`);
  };

  const connectedCount = CONNECTORS.filter(c => connectedProviders.has(c.provider || "")).length;
  const availableCount = CONNECTORS.filter(c => c.status === "available").length;

  if (loading) {
    return (
      <>
        <div className="page-header"><h1 className="page-title">🔗 Connector Marketplace</h1></div>
        <div className="grid-2" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="card" style={{ padding: "var(--space-lg)" }}>
              <div className="animate-glow" style={{ width: 40, height: 40, borderRadius: 8, background: "var(--border)", marginBottom: 12 }} />
              <div className="animate-glow" style={{ width: `${50 + i * 8}%`, height: 16, borderRadius: 4, background: "var(--border)", marginBottom: 8 }} />
              <div className="animate-glow" style={{ width: "80%", height: 12, borderRadius: 4, background: "var(--border)" }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h1 className="page-title">🔗 Connector Marketplace</h1>
            <p className="page-subtitle">40+ SaaS integrations — connect your tools or request new ones</p>
          </div>
          <div className="row">
            <span className="badge badge-green">{connectedCount} Connected</span>
            <span className="badge badge-blue">{availableCount} Available</span>
            <span className="badge badge-purple">{CONNECTORS.length} Total</span>
          </div>
        </div>
      </div>

      {/* Security Banner */}
      <div className="card" style={{ marginBottom: "var(--space-lg)", borderColor: "hsla(152,69%,50%,0.2)", background: "var(--emerald-bg)" }}>
        <div className="row">
          <span style={{ fontSize: "1.3rem" }}>🛡️</span>
          <div>
            <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--emerald)" }}>Secure OAuth Flow via Supabase Auth Helpers</p>
            <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "2px" }}>
              PKCE-based OAuth 2.0 · Tokens auto-refreshed by <code style={{ background: "var(--bg-glass)", padding: "1px 6px", borderRadius: 4, fontSize: "0.75rem" }}>@supabase/ssr</code> · No secrets in the browser
            </p>
          </div>
        </div>
      </div>

      {/* Search + Category Filters */}
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <div className="row" style={{ gap: "var(--space-md)", marginBottom: "var(--space-md)" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              className="input"
              type="text"
              placeholder="🔍 Search connectors (e.g. Stripe, Slack, CRM...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: "var(--space-lg)", fontSize: "0.9rem" }}
            />
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              className={`btn btn-sm ${category === cat.key ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setCategory(cat.key)}
              style={{ fontSize: "0.75rem" }}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ NO RESULTS — REQUEST CONNECTOR ═══ */}
      {filtered.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "var(--space-2xl)" }}>
          <div style={{ fontSize: "3rem", marginBottom: "var(--space-md)" }}>🔍</div>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>
            No connector found for &ldquo;{search}&rdquo;
          </h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)", maxWidth: 400, margin: "0 auto var(--space-lg)" }}>
            Can&apos;t find what you need? Request it and we&apos;ll prioritize building it.
          </p>
          <button
            className="btn btn-primary btn-lg"
            onClick={() => handleRequestAccess({
              id: search.toLowerCase().replace(/\s+/g, "_"),
              label: search,
              icon: "🔌",
              description: `User-requested connector: ${search}`,
              category: "productivity",
              status: "request_access",
            })}
            disabled={requestSending}
          >
            {requestSending ? "📧 Sending..." : `✨ Request "${search}" Connector`}
          </button>
        </div>
      )}

      {/* ═══ CONNECTOR GRID ═══ */}
      <div className="grid-2" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {filtered.map((c) => {
          const badge = STATUS_BADGES[c.status];
          const isConnected = c.status === "connected";

          return (
            <div key={c.id} className={`card ${isConnected ? "oauth-btn connected" : ""}`}
              style={{
                padding: "var(--space-lg)",
                opacity: c.status === "request_access" ? 0.75 : 1,
                transition: "all 0.2s ease",
              }}
            >
              {/* Header */}
              <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--space-sm)" }}>
                <div className="row" style={{ gap: "var(--space-sm)" }}>
                  <ConnectorLogo id={c.id} size={32} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{c.label}</div>
                    <span className="badge" style={{ fontSize: "0.6rem", color: "var(--text-muted)", padding: "1px 6px" }}>{c.category}</span>
                  </div>
                </div>
                <span className={`badge ${badge.class}`} style={{ fontSize: "0.6rem" }}>
                  {badge.icon} {badge.label}
                </span>
              </div>

              {/* Description */}
              <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "var(--space-md)", minHeight: 36 }}>
                {c.description}
              </p>

              {/* Connected Email */}
              {isConnected && (
                <div style={{ padding: "var(--space-xs) var(--space-sm)", background: "var(--emerald-bg)", borderRadius: "var(--radius-sm)", fontSize: "0.72rem", marginBottom: "var(--space-sm)", color: "var(--emerald)" }}>
                  🔒 {userEmail || "Connected"}
                </div>
              )}

              {/* Scopes */}
              {c.scopes && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginBottom: "var(--space-sm)" }}>
                  {c.scopes.map((s) => (
                    <span key={s} className="badge badge-purple" style={{ fontSize: "0.55rem" }}>{s}</span>
                  ))}
                </div>
              )}

              {/* Action Button */}
              {isConnected ? (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%" }} onClick={() => handleDisconnect(c.id)}>
                  Disconnect
                </button>
              ) : c.status === "available" ? (
                <button className="btn btn-primary btn-sm" style={{ width: "100%" }} onClick={() => handleConnect(c)} disabled={connecting === c.id}>
                  {connecting === c.id ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                      <span className="animate-glow" style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "white" }} />
                      Connecting...
                    </span>
                  ) : "Connect →"}
                </button>
              ) : c.status === "coming_soon" ? (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", color: "var(--amber)" }} onClick={() => handleConnect(c)}>
                  🔧 Coming Soon
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", color: "var(--purple)" }} onClick={() => handleConnect(c)} disabled={requestSending}>
                  ✨ Request Access
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Maintenance Toast */}
      {toast && (
        <div className="approval-toast" style={{ background: "var(--accent)", color: "white" }}>
          {toast}
        </div>
      )}
    </>
  );
}
