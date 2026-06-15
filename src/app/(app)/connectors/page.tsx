"use client";
import { useState, useEffect, useMemo } from "react";
import { createBrowserClient } from "@supabase/ssr";
import ConnectorLogo from "@/components/ConnectorLogos";

// ============================================================
// Connector Marketplace — 50 SaaS Platforms
// OAuth popup flow + API key modal flow, categorized.
// ============================================================

type ConnectorStatus = "connected" | "available" | "coming_soon" | "request_access";
type ConnectorCategory = "communication" | "crm" | "payments" | "ecommerce" | "devtools" | "cloud" | "analytics" | "productivity" | "social" | "ai" | "storage" | "marketing" | "hr" | "research";

interface ApiKeyField {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password";
}

interface ConnectorDef {
  id: string;
  label: string;
  icon: string;
  description: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  provider?: string;
  scopes?: string[];
  connectionType?: "oauth" | "apikey";
  apiKeyFields?: ApiKeyField[];
  apiKeyHelpText?: string;
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
  { key: "research", label: "Research", icon: "🔍" },
];

const CONNECTORS: ConnectorDef[] = [
  // ── OAuth connectors ──
  { id: "google", label: "Google Workspace", icon: "📧", description: "Gmail, Calendar, Drive, Sheets — email, scheduling, and file access in one connection.", category: "communication", status: "available", provider: "google", connectionType: "oauth", scopes: ["gmail", "calendar", "drive", "sheets"] },
  { id: "slack", label: "Slack", icon: "💬", description: "Post messages, read channels, DMs, and manage workflows. The backbone of agent notifications.", category: "communication", status: "available", provider: "slack", connectionType: "oauth", scopes: ["channels:read", "chat:write", "files:write"] },
  { id: "discord", label: "Discord", icon: "🎮", description: "Bot management, channel messaging, and community engagement automation.", category: "communication", status: "available", provider: "discord", connectionType: "oauth" },
  { id: "microsoft", label: "Microsoft 365", icon: "🪟", description: "Azure AD, Teams messaging, OneDrive, and enterprise workflow automation.", category: "communication", status: "available", provider: "microsoft", connectionType: "oauth", scopes: ["Teams", "OneDrive", "Azure AD"] },
  { id: "intercom", label: "Intercom", icon: "💬", description: "Customer messaging, product tours, and support ticket routing.", category: "crm", status: "available", provider: "intercom", connectionType: "oauth" },
  { id: "github", label: "GitHub", icon: "🐙", description: "Repository access, issues, PRs, and CI/CD — for code-gen and DevOps agents.", category: "devtools", status: "available", provider: "github", connectionType: "oauth" },
  { id: "notion", label: "Notion", icon: "📝", description: "Read/write pages, databases, and comments — for documentation and knowledge agents.", category: "productivity", status: "available", provider: "notion", connectionType: "oauth" },
  { id: "airtable", label: "Airtable", icon: "📊", description: "Spreadsheet-database hybrid for structured data management and automation.", category: "productivity", status: "available", provider: "airtable", connectionType: "oauth" },
  { id: "monday", label: "Monday.com", icon: "📅", description: "Work management, project tracking, and team collaboration.", category: "productivity", status: "available", provider: "monday", connectionType: "oauth" },
  { id: "asana", label: "Asana", icon: "🎯", description: "Task management, project timelines, and team workload planning.", category: "productivity", status: "available", provider: "asana", connectionType: "oauth" },
  { id: "dropbox", label: "Dropbox", icon: "📦", description: "File storage, sharing, and sync — for document management agents.", category: "storage", status: "available", provider: "dropbox", connectionType: "oauth" },
  { id: "box", label: "Box", icon: "📁", description: "Enterprise content management, secure file sharing, and collaboration.", category: "storage", status: "available", provider: "box", connectionType: "oauth" },
  { id: "zoho", label: "Zoho", icon: "📊", description: "Zoho CRM, Mail, Sheets, and 40+ Zoho apps — complete business suite integration.", category: "crm", status: "available", provider: "zoho", connectionType: "oauth", scopes: ["ZohoCRM.modules.ALL", "ZohoMail.messages.ALL"] },
  { id: "salesforce", label: "Salesforce", icon: "☁️", description: "CRM data, lead management, opportunity tracking, and sales pipeline automation.", category: "crm", status: "available", provider: "salesforce", connectionType: "oauth" },
  { id: "hubspot", label: "HubSpot", icon: "🧲", description: "Marketing automation, CRM contacts, deal tracking, and email campaigns.", category: "crm", status: "available", provider: "hubspot", connectionType: "oauth" },
  { id: "mailchimp", label: "Mailchimp", icon: "🐒", description: "Email campaigns, audience segmentation, and marketing automation.", category: "marketing", status: "available", provider: "mailchimp", connectionType: "oauth" },
  { id: "paypal", label: "PayPal", icon: "💰", description: "Payment processing, invoicing, and financial transaction management.", category: "payments", status: "available", provider: "paypal", connectionType: "oauth" },
  { id: "square", label: "Square", icon: "🟦", description: "POS payments, invoicing, and commerce solutions.", category: "payments", status: "available", provider: "square", connectionType: "oauth" },
  { id: "reddit", label: "Reddit", icon: "🤖", description: "Subreddit monitoring, comment analysis, and sentiment tracking.", category: "social", status: "available", provider: "reddit", connectionType: "oauth" },
  { id: "twitter", label: "X (Twitter)", icon: "🐦", description: "Post tweets, monitor mentions, analyze sentiment, and automate social presence.", category: "social", status: "available", provider: "twitter", connectionType: "oauth", scopes: ["tweet.read", "tweet.write", "users.read"] },
  { id: "linkedin", label: "LinkedIn", icon: "💼", description: "Profile data, messaging, and social selling for recruitment and networking agents.", category: "social", status: "available", provider: "linkedin_oidc", connectionType: "oauth", scopes: ["openid", "profile", "email", "w_member_social"] },
  { id: "facebook", label: "Facebook", icon: "📘", description: "Post to Pages, manage content, track engagement, and automate marketing.", category: "social", status: "available", provider: "facebook", connectionType: "oauth", scopes: ["pages_manage_posts", "pages_read_engagement"] },
  { id: "instagram", label: "Instagram", icon: "📸", description: "Post scheduling, analytics, and content automation.", category: "social", status: "available", provider: "instagram", connectionType: "oauth", scopes: ["instagram_basic", "instagram_content_publish"] },
  // Atlassian OAuth covers Jira + Confluence + Trello with one app connection
  { id: "jira", label: "Jira", icon: "📋", description: "Issue tracking, sprint management, and Agile workflow automation.", category: "devtools", status: "available", provider: "atlassian", connectionType: "oauth" },
  { id: "confluence", label: "Confluence", icon: "📖", description: "Wiki pages, knowledge base, and team documentation management.", category: "productivity", status: "available", provider: "atlassian", connectionType: "oauth" },
  { id: "trello", label: "Trello", icon: "📌", description: "Kanban boards, task cards, and visual project management.", category: "productivity", status: "available", provider: "atlassian", connectionType: "oauth" },

  // ── API key connectors (customers provide their own keys) ──
  { id: "stripe", label: "Stripe", icon: "💳", description: "Payment processing, subscription management, invoice generation, and financial reporting.", category: "payments", status: "available", provider: "stripe", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "Secret Key", placeholder: "sk_live_..." }], apiKeyHelpText: "Find in Stripe Dashboard → Developers → API Keys" },
  { id: "twilio", label: "Twilio", icon: "📞", description: "SMS, voice, video, and WhatsApp messaging for customer communication agents.", category: "communication", status: "available", provider: "twilio", connectionType: "apikey", apiKeyFields: [{ key: "accountSid", label: "Account SID", placeholder: "AC..." }, { key: "authToken", label: "Auth Token", placeholder: "Your auth token" }], apiKeyHelpText: "Find in Twilio Console → Account Info" },
  { id: "sendgrid", label: "SendGrid", icon: "✉️", description: "Transactional and marketing email at scale with delivery tracking.", category: "marketing", status: "available", provider: "sendgrid", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "API Key", placeholder: "SG..." }], apiKeyHelpText: "Find in SendGrid → Settings → API Keys" },
  { id: "aws", label: "Amazon Web Services", icon: "🟧", description: "S3, Lambda, CloudWatch, SES — full cloud infrastructure management.", category: "cloud", status: "available", provider: "aws", connectionType: "apikey", apiKeyFields: [{ key: "accessKeyId", label: "Access Key ID", placeholder: "AKIA..." }, { key: "secretAccessKey", label: "Secret Access Key", placeholder: "Your secret key" }], apiKeyHelpText: "Find in AWS Console → IAM → Security Credentials" },
  { id: "vercel", label: "Vercel", icon: "▲", description: "Deployment management, serverless functions, and edge network control.", category: "devtools", status: "available", provider: "vercel", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "API Token", placeholder: "Your Vercel token" }], apiKeyHelpText: "Find in Vercel → Settings → Tokens" },
  { id: "supabase_ext", label: "Supabase", icon: "⚡", description: "Direct database access, realtime subscriptions, and storage management.", category: "devtools", status: "available", provider: "supabase_ext", connectionType: "apikey", apiKeyFields: [{ key: "url", label: "Project URL", placeholder: "https://xxx.supabase.co" }, { key: "apiKey", label: "Service Role Key", placeholder: "eyJ..." }], apiKeyHelpText: "Find in Supabase → Settings → API" },
  { id: "firebase", label: "Firebase", icon: "🔥", description: "Firestore, Auth, Cloud Messaging, and hosting for mobile/web agents.", category: "cloud", status: "available", provider: "firebase", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "Web API Key", placeholder: "AIzaSy..." }], apiKeyHelpText: "Find in Firebase Console → Project Settings → General" },
  { id: "openai_api", label: "OpenAI", icon: "🤖", description: "GPT-4o, DALL-E, Whisper, and Embeddings for AI-powered agent reasoning.", category: "ai", status: "available", provider: "openai_api", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "API Key", placeholder: "sk-..." }], apiKeyHelpText: "Find in OpenAI Platform → API Keys" },
  { id: "anthropic_api", label: "Anthropic", icon: "🧠", description: "Claude for long-context reasoning, analysis, and safe AI decision-making.", category: "ai", status: "available", provider: "anthropic_api", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "API Key", placeholder: "sk-ant-..." }], apiKeyHelpText: "Find in Anthropic Console → API Keys" },
  { id: "replicate", label: "Replicate", icon: "🔬", description: "Run open-source ML models (Stable Diffusion, LLaMA, Whisper) via API.", category: "ai", status: "available", provider: "replicate", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "API Token", placeholder: "r8_..." }], apiKeyHelpText: "Find in Replicate → Account → API Tokens" },
  { id: "segment", label: "Segment", icon: "📡", description: "Customer data platform — unify, clean, and route analytics events.", category: "analytics", status: "available", provider: "segment", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "Write Key", placeholder: "Your write key" }], apiKeyHelpText: "Find in Segment → Sources → Your Source → Settings" },
  { id: "mixpanel", label: "Mixpanel", icon: "📈", description: "Product analytics, user flows, retention, and A/B test analysis.", category: "analytics", status: "available", provider: "mixpanel", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "Project Token", placeholder: "Your project token" }], apiKeyHelpText: "Find in Mixpanel → Project Settings → Access Keys" },
  { id: "make", label: "Make (Integromat)", icon: "🔄", description: "Visual automation builder with advanced data transformation.", category: "productivity", status: "available", provider: "make", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "API Token", placeholder: "Your Make API token" }], apiKeyHelpText: "Find in Make → Profile → API Access" },
  { id: "woocommerce", label: "WooCommerce", icon: "🛒", description: "WordPress e-commerce — products, orders, and inventory.", category: "ecommerce", status: "available", provider: "woocommerce", connectionType: "apikey", apiKeyFields: [{ key: "storeUrl", label: "Store URL", placeholder: "https://yourstore.com" }, { key: "consumerKey", label: "Consumer Key", placeholder: "ck_..." }, { key: "consumerSecret", label: "Consumer Secret", placeholder: "cs_..." }], apiKeyHelpText: "WordPress → WooCommerce → Settings → Advanced → REST API" },
  { id: "bamboohr", label: "BambooHR", icon: "🎋", description: "HR management, employee data, time-off, and onboarding.", category: "hr", status: "available", provider: "bamboohr", connectionType: "apikey", apiKeyFields: [{ key: "subdomain", label: "Subdomain", placeholder: "yourcompany" }, { key: "apiKey", label: "API Key", placeholder: "Your BambooHR API key" }], apiKeyHelpText: "Your BambooHR URL is yourcompany.bamboohr.com" },
  { id: "heygen", label: "HeyGen", icon: "🎬", description: "AI video generation — create talking avatar videos at scale.", category: "ai", status: "available", provider: "heygen", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "API Key", placeholder: "Your HeyGen API key" }], apiKeyHelpText: "Find in HeyGen → Settings → API" },
  { id: "langsmith", label: "LangSmith", icon: "🔗", description: "LLM tracing, evaluation, and debugging for AI agent pipelines.", category: "ai", status: "available", provider: "langsmith", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "API Key", placeholder: "ls__..." }], apiKeyHelpText: "Find in LangSmith → Settings → API Keys" },
  { id: "shiprocket", label: "Shiprocket", icon: "🚀", description: "Shipping and logistics automation — orders, tracking, and fulfillment.", category: "ecommerce", status: "available", provider: "shiprocket", connectionType: "apikey", apiKeyFields: [{ key: "email", label: "Email", placeholder: "your@email.com" }, { key: "password", label: "Password", placeholder: "Your Shiprocket password", type: "password" }], apiKeyHelpText: "Use your Shiprocket account credentials" },
  { id: "razorpay", label: "Razorpay", icon: "💸", description: "Indian payment gateway — orders, subscriptions, and payouts.", category: "payments", status: "available", provider: "razorpay", connectionType: "apikey", apiKeyFields: [{ key: "keyId", label: "Key ID", placeholder: "rzp_live_..." }, { key: "keySecret", label: "Key Secret", placeholder: "Your Razorpay key secret" }], apiKeyHelpText: "Find in Razorpay Dashboard → Settings → API Keys" },
  { id: "hunter", label: "Hunter.io", icon: "🎯", description: "Find verified professional email addresses by company domain — powers outreach and lead generation agents.", category: "research", status: "available", provider: "hunter", connectionType: "apikey", apiKeyFields: [{ key: "apiKey", label: "API Key", placeholder: "Your Hunter.io API key" }], apiKeyHelpText: "Find in Hunter.io → Dashboard → API (free plan: 25 searches/month)" },

  // ── Coming Soon ──
  { id: "shopify", label: "Shopify", icon: "🛍️", description: "Store management, product listings, order fulfillment, and inventory tracking.", category: "ecommerce", status: "coming_soon" },
  { id: "zendesk", label: "Zendesk", icon: "🎧", description: "Customer support tickets, live chat, and help center management.", category: "crm", status: "coming_soon" },
  { id: "gcp", label: "Google Cloud", icon: "🔵", description: "BigQuery, Cloud Functions, Pub/Sub, and GCS for data engineering agents.", category: "cloud", status: "coming_soon" },
  { id: "workday", label: "Workday", icon: "🏢", description: "Enterprise HCM, payroll, and workforce management.", category: "hr", status: "coming_soon" },
  { id: "tiktok", label: "TikTok", icon: "🎵", description: "Content analytics, ad management, and engagement tracking.", category: "social", status: "coming_soon" },
];

// OAuth route → the actual /api/oauth/[route] path
const OAUTH_ROUTE_MAP: Record<string, string> = {
  google: "google",
  slack: "slack",
  discord: "discord",
  microsoft: "microsoft",
  github: "github",
  notion: "notion",
  airtable: "airtable",
  monday: "monday",
  asana: "asana",
  dropbox: "dropbox",
  box: "box",
  zoho: "zoho",
  salesforce: "salesforce",
  hubspot: "hubspot",
  mailchimp: "mailchimp",
  intercom: "intercom",
  paypal: "paypal",
  square: "square",
  reddit: "reddit",
  twitter: "twitter",
  linkedin: "linkedin",
  facebook: "facebook",
  instagram: "instagram",
  // Atlassian covers Jira + Confluence + Trello with a single OAuth app
  jira: "atlassian",
  confluence: "atlassian",
  trello: "atlassian",
};

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
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [connectorDefs] = useState<ConnectorDef[]>(CONNECTORS);
  const [apiKeyModal, setApiKeyModal] = useState<ConnectorDef | null>(null);
  const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({});
  const [submittingApiKey, setSubmittingApiKey] = useState(false);
  const [requestSending, setRequestSending] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => { checkConnectionStatus(); }, []);

  const checkConnectionStatus = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    setUserEmail(user?.email || null);

    const providers = new Set<string>();
    const loginProvider = user?.app_metadata?.provider;
    if (loginProvider) providers.add(loginProvider);

    if (user) {
      try {
        const { data: tenantData } = await supabase.from('tenants').select('id').eq('owner_user_id', user.id).single();
        if (tenantData) {
          const { data: perms } = await supabase.from('tenant_permissions').select('provider').eq('tenant_id', tenantData.id);
          if (perms) perms.forEach(p => providers.add(p.provider));
        }
      } catch (e) {
        console.warn('Failed to fetch tenant permissions:', e);
      }
    }

    setConnectedProviders(providers);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let list = connectorDefs.map(c => ({
      ...c,
      status: connectedProviders.has(c.provider || '') ? 'connected' as ConnectorStatus : c.status,
    }));
    if (category !== 'all') list = list.filter(c => c.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.label.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.category.includes(q)
      );
    }
    const order: Record<ConnectorStatus, number> = { connected: 0, available: 1, coming_soon: 2, request_access: 3 };
    list.sort((a, b) => order[a.status] - order[b.status]);
    return list;
  }, [search, category, connectedProviders, connectorDefs]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_SUCCESS') {
        showToast(`✅ ${event.data.provider || 'Provider'} connected successfully!`);
        checkConnectionStatus();
      } else if (event.data?.type === 'OAUTH_ERROR') {
        showToast('❌ Connection failed. Please try again.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnect = async (connector: ConnectorDef) => {
    if (connector.status === 'coming_soon') {
      showToast(`🔧 ${connector.label} is coming soon. We'll notify you when it's ready.`);
      return;
    }
    if (connector.status === 'request_access') {
      handleRequestAccess(connector);
      return;
    }

    if (connector.connectionType === 'apikey') {
      setApiKeyValues({});
      setApiKeyModal(connector);
      return;
    }

    if (!connector.provider) return;
    setConnecting(connector.id);

    const oauthRoute = OAUTH_ROUTE_MAP[connector.id] || connector.provider || connector.id;
    const popup = window.open(`/api/oauth/${oauthRoute}`, 'oauth_window', 'width=500,height=600,scrollbars=yes');

    const pollTimer = setInterval(() => {
      if (popup && popup.closed) {
        clearInterval(pollTimer);
        setConnecting(null);
        setTimeout(() => checkConnectionStatus(), 1000);
      }
    }, 500);
  };

  const handleApiKeySubmit = async () => {
    if (!apiKeyModal) return;
    setSubmittingApiKey(true);
    try {
      const res = await fetch('/api/connectors/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: apiKeyModal.id, fields: apiKeyValues }),
      });
      if (res.ok) {
        showToast(`✅ ${apiKeyModal.label} connected successfully!`);
        setApiKeyModal(null);
        setApiKeyValues({});
        checkConnectionStatus();
      } else {
        const data = await res.json();
        showToast(`❌ ${data.error || 'Failed to save credentials'}`);
      }
    } catch {
      showToast('❌ Connection failed. Please try again.');
    }
    setSubmittingApiKey(false);
  };

  const handleRequestAccess = async (connector: ConnectorDef) => {
    setRequestSending(true);
    try {
      const res = await fetch('/api/request-connector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ connectorId: connector.id, connectorLabel: connector.label, userEmail }),
      });
      showToast(res.ok
        ? `✅ Request sent for ${connector.label}! We'll notify you when it's available.`
        : `📧 Request noted for ${connector.label}. We'll reach out when it's ready.`
      );
    } catch {
      showToast(`📧 Request noted for ${connector.label}. We'll reach out when it's ready.`);
    }
    setRequestSending(false);
  };

  const handleDisconnect = (id: string) => {
    const conn = connectorDefs.find(c => c.id === id);
    if (conn?.provider) {
      setConnectedProviders(prev => { const s = new Set(prev); s.delete(conn.provider!); return s; });
    }
    showToast(`✓ ${id} disconnected.`);
  };

  const connectedCount = connectorDefs.filter(c => connectedProviders.has(c.provider || '')).length;
  const availableCount = connectorDefs.filter(c => c.status === 'available').length;

  if (loading) {
    return (
      <>
        <div className="page-header"><h1 className="page-title">🔗 Connector Marketplace</h1></div>
        <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="card" style={{ padding: 'var(--space-lg)' }}>
              <div className="animate-glow" style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--border)', marginBottom: 12 }} />
              <div className="animate-glow" style={{ width: `${50 + i * 8}%`, height: 16, borderRadius: 4, background: 'var(--border)', marginBottom: 8 }} />
              <div className="animate-glow" style={{ width: '80%', height: 12, borderRadius: 4, background: 'var(--border)' }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">🔗 Connector Marketplace</h1>
            <p className="page-subtitle">50+ SaaS integrations — OAuth popup or API key, no code required</p>
          </div>
          <div className="row">
            <span className="badge badge-green">{connectedCount} Connected</span>
            <span className="badge badge-blue">{availableCount} Available</span>
            <span className="badge badge-purple">{connectorDefs.length} Total</span>
          </div>
        </div>
      </div>

      {/* Security Banner */}
      <div className="card" style={{ marginBottom: 'var(--space-lg)', borderColor: 'hsla(152,69%,50%,0.2)', background: 'var(--emerald-bg)' }}>
        <div className="row">
          <span style={{ fontSize: '1.3rem' }}>🛡️</span>
          <div>
            <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emerald)' }}>Secure · OAuth 2.0 + PKCE · API Keys encrypted at rest</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              OAuth tokens auto-refreshed · API keys stored in Supabase vault · No secrets in the browser
            </p>
          </div>
        </div>
      </div>

      {/* Search + Category Filters */}
      <div style={{ marginBottom: 'var(--space-lg)' }}>
        <div className="row" style={{ gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
          <div style={{ flex: 1 }}>
            <input
              className="input" type="text"
              placeholder="🔍 Search connectors (e.g. Stripe, Slack, CRM...)"
              value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ fontSize: '0.9rem' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {CATEGORIES.map(cat => (
            <button key={cat.key} className={`btn btn-sm ${category === cat.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setCategory(cat.key)} style={{ fontSize: '0.75rem' }}>
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>🔍</div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>
            No connector found for &ldquo;{search}&rdquo;
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-lg)', maxWidth: 400, margin: '0 auto var(--space-lg)' }}>
            Can&apos;t find what you need? Request it and we&apos;ll prioritize building it.
          </p>
          <button className="btn btn-primary btn-lg"
            onClick={() => handleRequestAccess({ id: search.toLowerCase().replace(/\s+/g, '_'), label: search, icon: '🔌', description: `User-requested: ${search}`, category: 'productivity', status: 'request_access' })}
            disabled={requestSending}>
            {requestSending ? '📧 Sending...' : `✨ Request "${search}" Connector`}
          </button>
        </div>
      )}

      {/* Connector Grid */}
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {filtered.map((c) => {
          const badge = STATUS_BADGES[c.status];
          const isConnected = c.status === 'connected';

          return (
            <div key={c.id} className={`card ${isConnected ? 'oauth-btn connected' : ''}`}
              style={{ padding: 'var(--space-lg)', opacity: c.status === 'request_access' ? 0.75 : 1, transition: 'all 0.2s ease' }}>

              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                <div className="row" style={{ gap: 'var(--space-sm)' }}>
                  <ConnectorLogo id={c.id} size={32} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{c.label}</div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span className="badge" style={{ fontSize: '0.6rem', color: 'var(--text-muted)', padding: '1px 6px' }}>{c.category}</span>
                      {c.connectionType === 'apikey' && (
                        <span className="badge" style={{ fontSize: '0.55rem', color: 'var(--text-muted)', padding: '1px 6px', background: 'var(--bg-glass)' }}>🔑 API Key</span>
                      )}
                    </div>
                  </div>
                </div>
                <span className={`badge ${badge.class}`} style={{ fontSize: '0.6rem' }}>{badge.icon} {badge.label}</span>
              </div>

              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 'var(--space-md)', minHeight: 36 }}>
                {c.description}
              </p>

              {isConnected && (
                <div style={{ padding: 'var(--space-xs) var(--space-sm)', background: 'var(--emerald-bg)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', marginBottom: 'var(--space-sm)', color: 'var(--emerald)' }}>
                  🔒 {userEmail || 'Connected'}
                </div>
              )}

              {c.scopes && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: 'var(--space-sm)' }}>
                  {c.scopes.map(scope => (
                    <span key={scope} className="badge badge-purple" style={{ fontSize: '0.55rem' }}>{scope}</span>
                  ))}
                </div>
              )}

              {isConnected ? (
                <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={() => handleDisconnect(c.id)}>
                  Disconnect
                </button>
              ) : c.status === 'available' ? (
                <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={() => handleConnect(c)} disabled={connecting === c.id}>
                  {connecting === c.id ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                      <span className="animate-glow" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: 'white' }} />
                      Connecting...
                    </span>
                  ) : c.connectionType === 'apikey' ? '🔑 Add API Key →' : 'Connect →'}
                </button>
              ) : c.status === 'coming_soon' ? (
                <button className="btn btn-ghost btn-sm" style={{ width: '100%', color: 'var(--amber)' }} onClick={() => handleConnect(c)}>
                  🔧 Coming Soon
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ width: '100%', color: 'var(--purple)' }} onClick={() => handleConnect(c)} disabled={requestSending}>
                  ✨ Request Access
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* API Key Modal */}
      {apiKeyModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
          onClick={() => { setApiKeyModal(null); setApiKeyValues({}); }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 480, padding: 'var(--space-xl)' }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--space-lg)' }}>
              <div className="row" style={{ gap: 'var(--space-sm)' }}>
                <ConnectorLogo id={apiKeyModal.id} size={40} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>Connect {apiKeyModal.label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>🔑 API Key Setup — credentials stored securely</div>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { setApiKeyModal(null); setApiKeyValues({}); }} style={{ flexShrink: 0 }}>✕</button>
            </div>

            {/* Help Text */}
            {apiKeyModal.apiKeyHelpText && (
              <div style={{ padding: 'var(--space-sm) var(--space-md)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-lg)', borderLeft: '3px solid var(--accent)' }}>
                ℹ️ {apiKeyModal.apiKeyHelpText}
              </div>
            )}

            {/* Fields */}
            {apiKeyModal.apiKeyFields?.map(field => (
              <div key={field.key} style={{ marginBottom: 'var(--space-md)' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>{field.label}</label>
                <input
                  className="input"
                  type={field.type || 'text'}
                  placeholder={field.placeholder}
                  value={apiKeyValues[field.key] || ''}
                  onChange={e => setApiKeyValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                  style={{ fontSize: '0.85rem', fontFamily: field.type === 'password' ? 'inherit' : 'monospace' }}
                  autoComplete="off"
                />
              </div>
            ))}

            {/* Actions */}
            <div className="row" style={{ gap: 'var(--space-sm)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
              <button className="btn btn-ghost" onClick={() => { setApiKeyModal(null); setApiKeyValues({}); }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleApiKeySubmit} disabled={submittingApiKey}>
                {submittingApiKey ? 'Saving...' : 'Save Credentials →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="approval-toast" style={{ background: 'var(--accent)', color: 'white' }}>{toast}</div>
      )}
    </>
  );
}
