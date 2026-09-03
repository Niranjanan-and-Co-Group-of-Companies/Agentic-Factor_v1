"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { createBrowserClient } from "@supabase/ssr";

// ============================================================
// Connector Marketplace — 850+ integrations via Composio
// ============================================================

interface Toolkit {
  slug: string;
  name: string;
  logo: string;
  description: string;
  categories: string[];
  tools_count: number;
  auth_schemes: string[];
  no_auth: boolean;
}

interface CustomConnector {
  provider: string;
  metadata: { display_name: string; base_url: string | null; auth_type: string } | null;
  updated_at: string;
}

// Legacy AF provider key → Composio slug (so old connected rows still show as connected)
const LEGACY_TO_SLUG: Record<string, string> = {
  google: "gmail",
  microsoft: "outlook",
  monday: "mondaydotcom",
  linkedin_oidc: "linkedin",
  atlassian: "jira",
};

// Specific API key fields for popular connectors (slug → label)
const API_KEY_LABELS: Record<string, string> = {
  stripe: "Secret Key (sk_live_...)",
  twilio: "Auth Token",
  sendgrid: "API Key (SG...)",
  openai: "API Key (sk-...)",
  anthropic: "API Key (sk-ant-...)",
  razorpay: "Key Secret",
  apollo: "API Key",
  shopify: "Access Token",
  zendesk: "API Token",
  bamboohr: "API Key",
  firebase: "Web API Key",
  buffer: "Access Token (from buffer.com/developers/apps)",
  gemini: "API Key (from aistudio.google.com)",
  perplexity: "API Key (pplx-...)",
};

// Hardcoded connector cards — not in Composio catalog
const BUFFER_TOOLKIT: Toolkit = {
  slug: "buffer",
  name: "Buffer",
  logo: "https://buffer.com/favicon.ico",
  description: "Schedule and publish to Facebook Pages, Instagram Business, LinkedIn, and Twitter. The recommended way to post to social media — no Meta app review required.",
  categories: ["social-media"],
  tools_count: 6,
  auth_schemes: ["BEARER_TOKEN"],
  no_auth: false,
};

const OPENAI_TOOLKIT: Toolkit = {
  slug: "openai",
  name: "OpenAI",
  logo: "https://openai.com/favicon.ico",
  description: "DALL-E 3 image generation, Whisper audio transcription, GPT-4o Vision image analysis, and text-to-speech. Required for any mission that generates or analyses images.",
  categories: ["artificial-intelligence"],
  tools_count: 5,
  auth_schemes: ["BEARER_TOKEN"],
  no_auth: false,
};

const GEMINI_TOOLKIT: Toolkit = {
  slug: "gemini",
  name: "Google Gemini",
  logo: "https://www.gstatic.com/lamda/images/favicon_v1_150160cddff7f294ce30.svg",
  description: "Gemini 2.0 Flash for fast AI reasoning, Gemini 1.5 Pro for 1-million-token document analysis, and Gemini Vision for image and PDF understanding inside agent code.",
  categories: ["artificial-intelligence"],
  tools_count: 4,
  auth_schemes: ["API_KEY"],
  no_auth: false,
};

const CANVA_TOOLKIT: Toolkit = {
  slug: "canva",
  name: "Canva",
  logo: "https://logos.composio.dev/api/canva",
  description: "Create and export designs, auto-fill brand templates, upload assets, list user designs, and export to PNG/PDF/MP4. Connect once — agents can design at scale via Canva's API.",
  categories: ["images-&-design"],
  tools_count: 46,
  auth_schemes: ["OAUTH2"],
  no_auth: false,
};

// Search terms that should show the Buffer social media guidance banner
const SOCIAL_SEARCH_TERMS = ["facebook", "instagram", "meta", "fb ", "insta"];
// Search terms that should surface the AI model connectors
const AI_SEARCH_TERMS = ["openai", "dall", "whisper", "gpt", "image gen", "gemini", "google ai", "vertex", "google gemini"];
// Search terms that should surface the Canva design connector
const CANVA_SEARCH_TERMS = ["canva", "design", "graphic", "template", "presentation", "poster", "banner"];

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function isOAuthApp(tk: Toolkit): boolean {
  return tk.auth_schemes.some(s => s === "OAUTH2" || s === "OAUTH1" || s === "DCR_OAUTH");
}

function isApiKeyApp(tk: Toolkit): boolean {
  if (tk.no_auth) return false;
  if (isOAuthApp(tk)) return false;
  return tk.auth_schemes.some(s => ["API_KEY", "BEARER_TOKEN", "BASIC", "BASIC_WITH_JWT"].includes(s));
}

export default function ConnectorsPage() {
  const [toolkits, setToolkits]               = useState<Toolkit[]>([]);
  const [nextCursor, setNextCursor]           = useState<string | null>(null);
  const [totalItems, setTotalItems]           = useState(0);
  const [loadingCatalog, setLoadingCatalog]   = useState(true);
  const [loadingMore, setLoadingMore]         = useState(false);
  const [connectedSlugs, setConnectedSlugs]   = useState<Set<string>>(new Set());
  const [connecting, setConnecting]           = useState<string | null>(null);
  const [userEmail, setUserEmail]             = useState<string | null>(null);
  const [search, setSearch]                   = useState("");
  const [activeCategory, setActiveCategory]   = useState("all");
  const [toast, setToast]                     = useState<string | null>(null);
  const [apiKeyModal, setApiKeyModal]         = useState<Toolkit | null>(null);
  const [apiKeyValue, setApiKeyValue]         = useState("");
  const [savingKey, setSavingKey]             = useState(false);
  const [keyError, setKeyError]               = useState<string | null>(null);
  const [keySuccess, setKeySuccess]           = useState(false);
  const [keyAccountInfo, setKeyAccountInfo]   = useState<string | null>(null);
  const [customConnectors, setCustomConnectors] = useState<CustomConnector[]>([]);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customForm, setCustomForm]           = useState({ name: "", api_key: "", base_url: "", auth_type: "bearer" });
  const [savingCustom, setSavingCustom]       = useState(false);
  const [customError, setCustomError]         = useState<string | null>(null);
  const [searchResults, setSearchResults]     = useState<Toolkit[] | null>(null);
  const [searching, setSearching]             = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  // ── Load catalog ──────────────────────────────────────────
  const loadCatalog = useCallback(async (cursor?: string) => {
    if (!cursor) setLoadingCatalog(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/composio/apps?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json() as { items: Toolkit[]; next_cursor: string | null; total_items: number };
      setToolkits(prev => cursor ? [...prev, ...data.items] : data.items);
      setNextCursor(data.next_cursor);
      setTotalItems(data.total_items);
    } catch {
      showToast("⚠️ Could not load integrations. Please refresh.");
    }
    setLoadingCatalog(false);
    setLoadingMore(false);
  }, []);

  // ── Load connected status ─────────────────────────────────
  const checkConnectionStatus = useCallback(async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    setUserEmail(user?.email ?? null);
    if (!user) return;

    const { data: perms } = await supabase
      .from("tenant_permissions")
      .select("provider")
      .eq("tenant_id", user.id);

    const slugs = new Set<string>();
    (perms ?? []).forEach(p => {
      slugs.add(p.provider);
      // Also map legacy AF keys (e.g. "google" → "gmail") so old rows still show connected
      const mapped = LEGACY_TO_SLUG[p.provider];
      if (mapped) slugs.add(mapped);
    });
    setConnectedSlugs(slugs);
  }, []);

  const fetchCustomConnectors = useCallback(async () => {
    try {
      const res = await fetch("/api/connectors/custom", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { connectors: CustomConnector[] };
        setCustomConnectors(data.connectors ?? []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadCatalog();
    checkConnectionStatus();
    fetchCustomConnectors();
  }, [loadCatalog, checkConnectionStatus, fetchCustomConnectors]);

  // Server-side search — debounced 400ms
  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ search: search.trim(), limit: "50" });
        const res = await fetch(`/api/composio/apps?${params}`);
        if (res.ok) {
          const data = await res.json() as { items: Toolkit[]; next_cursor: string | null; total_items: number };
          setSearchResults(data.items);
        }
      } catch { /* silent */ }
      setSearching(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // ── OAuth popup listener ───────────────────────────────────
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.data?.type === "OAUTH_SUCCESS") {
        showToast(`✅ ${e.data.provider || "App"} connected!`);
        checkConnectionStatus();
      } else if (e.data?.type === "OAUTH_ERROR") {
        showToast("❌ Connection failed. Please try again.");
      }
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [checkConnectionStatus]);

  // ── Derived categories from loaded toolkits ───────────────
  const categories = useMemo(() => {
    const cats = new Set<string>();
    toolkits.forEach(tk => tk.categories.forEach(c => cats.add(c)));
    const sorted = Array.from(cats).sort();
    return [{ key: "all", label: "All" }, ...sorted.map(c => ({ key: c, label: c.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()) }))];
  }, [toolkits]);

  // ── Filtered list ─────────────────────────────────────────
  const filtered = useMemo(() => {
    // When search is active, use server results (accurate, full-catalog);
    // fall back to client-side filter only while server results are loading.
    let list: Toolkit[];
    if (search.trim()) {
      if (searchResults !== null) {
        list = searchResults;
      } else {
        const q = search.toLowerCase();
        list = toolkits.filter(tk =>
          tk.name.toLowerCase().includes(q) ||
          tk.slug.toLowerCase().includes(q) ||
          tk.description.toLowerCase().includes(q) ||
          tk.categories.some(c => c.includes(q))
        );
      }
    } else {
      list = toolkits;
    }
    if (activeCategory !== "all") list = list.filter(tk => tk.categories.includes(activeCategory));
    return [...list].sort((a, b) => {
      const ac = connectedSlugs.has(a.slug) ? 0 : 1;
      const bc = connectedSlugs.has(b.slug) ? 0 : 1;
      return ac - bc;
    });
  }, [toolkits, searchResults, activeCategory, search, connectedSlugs]);

  const connectedCount = toolkits.filter(tk => connectedSlugs.has(tk.slug)).length;

  const showSocialBanner = SOCIAL_SEARCH_TERMS.some(t => search.toLowerCase().includes(t));
  const bufferConnected = connectedSlugs.has("buffer");
  const showBufferCard = !search.trim() || search.toLowerCase().includes("buffer") || showSocialBanner;
  const showAICards = !search.trim() || AI_SEARCH_TERMS.some(t => search.toLowerCase().includes(t));
  const openaiConnected = connectedSlugs.has("openai");
  const geminiConnected = connectedSlugs.has("gemini");
  const showCanvaCard = !search.trim() || CANVA_SEARCH_TERMS.some(t => search.toLowerCase().includes(t));
  const canvaConnected = connectedSlugs.has("canva");

  // ── Handlers ──────────────────────────────────────────────
  const handleConnect = async (tk: Toolkit) => {
    setConnecting(tk.slug);
    try {
      const res = await fetch("/api/composio/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: tk.slug }),
      });
      const data = await res.json() as { authUrl?: string; error?: string };
      if (!res.ok || !data.authUrl) {
        showToast(`❌ Could not start connection for ${tk.name}. Try again.`);
        setConnecting(null);
        return;
      }
      const popup = window.open(data.authUrl, "oauth_window", "width=500,height=700,scrollbars=yes");
      const poll = setInterval(() => {
        if (popup?.closed) {
          clearInterval(poll);
          setConnecting(null);
          setTimeout(() => checkConnectionStatus(), 1500);
        }
      }, 500);
    } catch {
      showToast(`❌ Connection failed for ${tk.name}.`);
      setConnecting(null);
    }
  };

  const handleDisconnect = async (tk: Toolkit) => {
    try {
      const res = await fetch("/api/composio/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: tk.slug }),
      });
      if (!res.ok) throw new Error("Disconnect failed");
      // Remove both the slug and any legacy key that maps to it
      setConnectedSlugs(prev => {
        const s = new Set(prev);
        s.delete(tk.slug);
        // Remove legacy AF key form too (e.g. "gmail" → also remove "google")
        Object.entries(LEGACY_TO_SLUG).forEach(([afKey, slug]) => {
          if (slug === tk.slug) s.delete(afKey);
        });
        return s;
      });
      showToast(`✓ ${tk.name} disconnected.`);
    } catch {
      showToast("❌ Could not disconnect. Please try again.");
    }
  };

  const handleApiKeyOpen = (tk: Toolkit) => {
    setApiKeyValue("");
    setKeyError(null);
    setKeySuccess(false);
    setKeyAccountInfo(null);
    setApiKeyModal(tk);
  };

  const handleApiKeySave = async () => {
    if (!apiKeyModal || !apiKeyValue.trim()) { setKeyError("API key is required"); return; }
    setSavingKey(true);
    setKeyError(null);
    setKeyAccountInfo(null);
    try {
      // Step 1: verify the key against the real service
      const verifyRes = await fetch("/api/connectors/apikey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: apiKeyModal.slug, fields: { apiKey: apiKeyValue.trim() } }),
      });
      const verifyData = await verifyRes.json() as { verified: boolean; error?: string; accountInfo?: string };
      if (!verifyData.verified) {
        setKeyError(verifyData.error ?? "Invalid API key — please check and try again.");
        setSavingKey(false);
        return;
      }
      if (verifyData.accountInfo) setKeyAccountInfo(verifyData.accountInfo);

      // Step 2: save the verified key
      const saveRes = await fetch("/api/connectors/apikey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: apiKeyModal.slug, fields: { apiKey: apiKeyValue.trim() } }),
      });
      const saveData = await saveRes.json() as { success?: boolean; error?: string };
      if (!saveRes.ok || !saveData.success) { setKeyError(saveData.error ?? "Failed to save"); setSavingKey(false); return; }
      // Register with Composio so agents can use its action catalog (non-fatal)
      fetch('/api/composio/connect-apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: apiKeyModal.slug, apiKey: apiKeyValue.trim() }),
      }).catch(() => {});
      setKeySuccess(true);
      setTimeout(() => {
        showToast(`✅ ${apiKeyModal.name} connected!`);
        setApiKeyModal(null);
        checkConnectionStatus();
      }, 1200);
    } catch {
      setKeyError("Network error. Please try again.");
    }
    setSavingKey(false);
  };

  const handleSaveCustom = async () => {
    if (!customForm.name.trim()) { setCustomError("Name is required"); return; }
    if (!customForm.api_key.trim()) { setCustomError("API Key is required"); return; }
    setSavingCustom(true); setCustomError(null);
    try {
      const res = await fetch("/api/connectors/custom", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(customForm),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) { setCustomError(data.error ?? "Failed"); setSavingCustom(false); return; }
      showToast(`✅ ${customForm.name} connected!`);
      setShowCustomModal(false);
      setCustomForm({ name: "", api_key: "", base_url: "", auth_type: "bearer" });
      fetchCustomConnectors();
    } catch { setCustomError("Network error"); }
    setSavingCustom(false);
  };

  // ── Skeleton ──────────────────────────────────────────────
  if (loadingCatalog) return (
    <>
      <div className="page-header">
        <h1 className="page-title">🔗 850+ Integrations — connect anything</h1>
        <p className="page-subtitle">OAuth or API key · no code required · enterprise-grade encryption</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--space-md)" }}>
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: "var(--space-lg)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
              <div className="animate-glow" style={{ width: 36, height: 36, borderRadius: 8, background: "var(--border)" }} />
              <div className="animate-glow" style={{ width: "55%", height: 14, borderRadius: 4, background: "var(--border)" }} />
            </div>
            <div className="animate-glow" style={{ width: "90%", height: 11, borderRadius: 4, background: "var(--border)", marginBottom: 6 }} />
            <div className="animate-glow" style={{ width: "70%", height: 11, borderRadius: 4, background: "var(--border)", marginBottom: 16 }} />
            <div className="animate-glow" style={{ width: "100%", height: 30, borderRadius: 6, background: "var(--border)" }} />
          </div>
        ))}
      </div>
    </>
  );

  return (
    <>
      {/* ── Hero Header ── */}
      <div className="page-header" style={{ marginBottom: "var(--space-lg)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "var(--space-md)" }}>
          <div>
            <h1 className="page-title">🔗 850+ Integrations — connect anything</h1>
            <p className="page-subtitle">OAuth or API key · no code required · enterprise-grade encryption</p>
          </div>
          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
            <span className="badge badge-green">{connectedCount} Connected</span>
            <span className="badge badge-purple">{totalItems || "850+"}  Total</span>
          </div>
        </div>
      </div>

      {/* ── Security Banner ── */}
      <div className="card" style={{ marginBottom: "var(--space-lg)", borderColor: "hsla(152,69%,50%,0.2)", background: "var(--emerald-bg)" }}>
        <div className="row">
          <span style={{ fontSize: "1.2rem" }}>🛡️</span>
          <div>
            <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--emerald)" }}>Secure · OAuth 2.0 + PKCE · 850+ integrations · API Keys encrypted at rest</p>
            <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 2 }}>
              OAuth tokens auto-refreshed · API keys stored in encrypted vault · No secrets stored in the browser
            </p>
          </div>
        </div>
      </div>

      {/* ── Search ── */}
      <div style={{ marginBottom: "var(--space-md)" }}>
        <input
          className="input" type="text"
          placeholder={`🔍 Search ${totalItems || "850+"}  integrations (e.g. Gmail, Stripe, CRM...)`}
          value={search} onChange={e => setSearch(e.target.value)}
          autoComplete="off" name="connector-search"
          style={{ fontSize: "0.9rem" }}
        />
      </div>

      {/* ── Category Filter ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "var(--space-xl)" }}>
        {categories.map(cat => (
          <button key={cat.key}
            className={`btn btn-sm ${activeCategory === cat.key ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setActiveCategory(cat.key)}
            style={{ fontSize: "0.73rem", textTransform: "capitalize" }}>
            {cat.label}
          </button>
        ))}
      </div>

      {/* ── Social Media Guidance Banner ── */}
      {showSocialBanner && (
        <div className="card" style={{ marginBottom: "var(--space-lg)", borderColor: "hsla(38,92%,55%,0.3)", background: "hsla(38,92%,55%,0.06)" }}>
          <div className="row" style={{ gap: "var(--space-md)" }}>
            <span style={{ fontSize: "1.4rem", flexShrink: 0 }}>💡</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 4, color: "var(--amber)" }}>
                For Facebook & Instagram posting, use Buffer
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Meta&apos;s API requires a verified Business Manager app to post to Facebook Pages or Instagram. Buffer already has this approval — connect Buffer once and your agents can post to Facebook, Instagram, LinkedIn, and Twitter without any extra setup.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── No results ── */}
      {filtered.length === 0 && !showBufferCard && !showAICards && !showCanvaCard && (
        <div className="card" style={{ textAlign: "center", padding: "var(--space-2xl)" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>🔍</div>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>No results for &ldquo;{search}&rdquo;</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Try a different name or use the custom connector below to add any REST API.
          </p>
        </div>
      )}
      {filtered.length === 0 && (showBufferCard || showAICards) && !showSocialBanner && !showAICards && (
        <div className="card" style={{ textAlign: "center", padding: "var(--space-xl)", marginBottom: "var(--space-md)" }}>
          <div style={{ fontSize: "2rem", marginBottom: "var(--space-sm)" }}>🔍</div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No other results for &ldquo;{search}&rdquo; — but Buffer is available below.</p>
        </div>
      )}

      {/* ── Toolkit Grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--space-md)" }}>
        {/* ── Pinned Buffer Card ── */}
        {showBufferCard && (() => {
          const tk = BUFFER_TOOLKIT;
          return (
            <div key="buffer" className="card" style={{
              padding: "var(--space-lg)",
              transition: "all 0.2s",
              ...(bufferConnected ? { borderColor: "hsla(152,69%,50%,0.35)" } : { borderColor: "hsla(38,92%,55%,0.25)" }),
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-sm)" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tk.logo}
                    alt={tk.name}
                    width={36} height={36}
                    style={{ borderRadius: 8, objectFit: "contain", background: "var(--bg-glass)", padding: 2 }}
                    onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=Buffer&size=36&background=3b82f6&color=fff&bold=true&length=2`; }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.2 }}>Buffer</div>
                    <div style={{ fontSize: "0.65rem", color: "var(--amber)", textTransform: "uppercase", letterSpacing: "0.4px", marginTop: 2 }}>social media</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                  {bufferConnected
                    ? <span className="badge badge-green" style={{ fontSize: "0.6rem" }}>✓ Connected</span>
                    : <span className="badge" style={{ fontSize: "0.55rem", color: "var(--amber)", borderColor: "var(--amber)", padding: "1px 5px" }}>API Key</span>
                  }
                  <span className="badge" style={{ fontSize: "0.55rem", color: "var(--accent)", borderColor: "var(--accent)", padding: "1px 5px" }}>Recommended</span>
                </div>
              </div>
              <p style={{ fontSize: "0.77rem", color: "var(--text-secondary)", lineHeight: 1.5, minHeight: 34, marginBottom: "var(--space-sm)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {tk.description}
              </p>
              {bufferConnected && userEmail && (
                <div style={{ padding: "4px 10px", background: "var(--emerald-bg)", borderRadius: "var(--radius-sm)", fontSize: "0.7rem", color: "var(--emerald)", marginBottom: "var(--space-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  🔒 {userEmail}
                </div>
              )}
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
                Facebook · Instagram · LinkedIn · Twitter · Pinterest
              </div>
              {bufferConnected ? (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", color: "var(--rose)", borderColor: "hsla(0,84%,60%,0.25)" }}
                  onClick={() => handleDisconnect(tk)}>
                  Disconnect
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", color: "var(--amber)", borderColor: "hsla(38,92%,55%,0.3)" }}
                  onClick={() => handleApiKeyOpen(tk)}>
                  🔑 Add Access Token →
                </button>
              )}
            </div>
          );
        })()}
        {/* ── Pinned OpenAI Card ── */}
        {showAICards && (() => {
          const tk = OPENAI_TOOLKIT;
          return (
            <div key="openai" className="card" style={{
              padding: "var(--space-lg)",
              transition: "all 0.2s",
              ...(openaiConnected ? { borderColor: "hsla(152,69%,50%,0.35)" } : { borderColor: "hsla(267,83%,65%,0.2)" }),
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-sm)" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tk.logo}
                    alt={tk.name}
                    width={36} height={36}
                    style={{ borderRadius: 8, objectFit: "contain", background: "var(--bg-glass)", padding: 2 }}
                    onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=OpenAI&size=36&background=10a37f&color=fff&bold=true&length=2`; }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.2 }}>OpenAI</div>
                    <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginTop: 2 }}>AI Models</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                  {openaiConnected
                    ? <span className="badge badge-green" style={{ fontSize: "0.6rem" }}>✓ Connected</span>
                    : <span className="badge" style={{ fontSize: "0.55rem", color: "var(--amber)", borderColor: "var(--amber)", padding: "1px 5px" }}>API Key</span>
                  }
                </div>
              </div>
              <p style={{ fontSize: "0.77rem", color: "var(--text-secondary)", lineHeight: 1.5, minHeight: 34, marginBottom: "var(--space-sm)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {tk.description}
              </p>
              {openaiConnected && userEmail && (
                <div style={{ padding: "4px 10px", background: "var(--emerald-bg)", borderRadius: "var(--radius-sm)", fontSize: "0.7rem", color: "var(--emerald)", marginBottom: "var(--space-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  🔒 {userEmail}
                </div>
              )}
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
                DALL-E 3 · Whisper · GPT-4o Vision · TTS
              </div>
              {openaiConnected ? (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", color: "var(--rose)", borderColor: "hsla(0,84%,60%,0.25)" }}
                  onClick={() => handleDisconnect(tk)}>
                  Disconnect
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", color: "var(--accent)", borderColor: "hsla(267,83%,65%,0.25)" }}
                  onClick={() => handleApiKeyOpen(tk)}>
                  🔑 Add API Key →
                </button>
              )}
            </div>
          );
        })()}

        {/* ── Pinned Gemini Card ── */}
        {showAICards && (() => {
          const tk = GEMINI_TOOLKIT;
          return (
            <div key="gemini" className="card" style={{
              padding: "var(--space-lg)",
              transition: "all 0.2s",
              ...(geminiConnected ? { borderColor: "hsla(152,69%,50%,0.35)" } : { borderColor: "hsla(214,89%,52%,0.2)" }),
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-sm)" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tk.logo}
                    alt={tk.name}
                    width={36} height={36}
                    style={{ borderRadius: 8, objectFit: "contain", background: "var(--bg-glass)", padding: 2 }}
                    onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=Gemini&size=36&background=4285f4&color=fff&bold=true&length=2`; }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.2 }}>Google Gemini</div>
                    <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginTop: 2 }}>AI Models</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                  {geminiConnected
                    ? <span className="badge badge-green" style={{ fontSize: "0.6rem" }}>✓ Connected</span>
                    : <span className="badge" style={{ fontSize: "0.55rem", color: "var(--amber)", borderColor: "var(--amber)", padding: "1px 5px" }}>API Key</span>
                  }
                </div>
              </div>
              <p style={{ fontSize: "0.77rem", color: "var(--text-secondary)", lineHeight: 1.5, minHeight: 34, marginBottom: "var(--space-sm)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {tk.description}
              </p>
              {geminiConnected && userEmail && (
                <div style={{ padding: "4px 10px", background: "var(--emerald-bg)", borderRadius: "var(--radius-sm)", fontSize: "0.7rem", color: "var(--emerald)", marginBottom: "var(--space-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  🔒 {userEmail}
                </div>
              )}
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
                Gemini 2.0 Flash · Gemini 1.5 Pro · Vision · 1M context
              </div>
              {geminiConnected ? (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", color: "var(--rose)", borderColor: "hsla(0,84%,60%,0.25)" }}
                  onClick={() => handleDisconnect(tk)}>
                  Disconnect
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", color: "hsla(214,89%,52%,1)", borderColor: "hsla(214,89%,52%,0.25)" }}
                  onClick={() => handleApiKeyOpen(tk)}>
                  🔑 Add API Key →
                </button>
              )}
            </div>
          );
        })()}

        {/* ── Pinned Canva Card ── */}
        {showCanvaCard && (() => {
          const tk = CANVA_TOOLKIT;
          return (
            <div key="canva" className="card" style={{
              padding: "var(--space-lg)",
              transition: "all 0.2s",
              ...(canvaConnected ? { borderColor: "hsla(152,69%,50%,0.35)" } : { borderColor: "hsla(353,100%,50%,0.18)" }),
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-sm)" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tk.logo}
                    alt={tk.name}
                    width={36} height={36}
                    style={{ borderRadius: 8, objectFit: "contain", background: "var(--bg-glass)", padding: 2 }}
                    onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=Canva&size=36&background=7d2ae8&color=fff&bold=true&length=2`; }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.2 }}>Canva</div>
                    <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginTop: 2 }}>Design · 46 actions</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                  {canvaConnected
                    ? <span className="badge badge-green" style={{ fontSize: "0.6rem" }}>✓ Connected</span>
                    : <span className="badge" style={{ fontSize: "0.55rem", color: "var(--accent)", borderColor: "var(--accent)", padding: "1px 5px" }}>OAuth</span>
                  }
                </div>
              </div>
              <p style={{ fontSize: "0.77rem", color: "var(--text-secondary)", lineHeight: 1.5, minHeight: 34, marginBottom: "var(--space-sm)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {tk.description}
              </p>
              {canvaConnected && userEmail && (
                <div style={{ padding: "4px 10px", background: "var(--emerald-bg)", borderRadius: "var(--radius-sm)", fontSize: "0.7rem", color: "var(--emerald)", marginBottom: "var(--space-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  🔒 {userEmail}
                </div>
              )}
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
                Create designs · Export PNG/PDF/MP4 · Auto-fill templates · Upload assets
              </div>
              {canvaConnected ? (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", color: "var(--rose)", borderColor: "hsla(0,84%,60%,0.25)" }}
                  onClick={() => handleDisconnect(tk)}>
                  Disconnect
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" style={{ width: "100%" }}
                  onClick={() => handleConnect(tk)}
                  disabled={connecting === tk.slug}>
                  {connecting === tk.slug ? "Connecting…" : "Connect with Canva →"}
                </button>
              )}
            </div>
          );
        })()}

        {filtered.map(tk => {
          const connected = connectedSlugs.has(tk.slug);
          const isConnecting = connecting === tk.slug;
          const isOAuth = isOAuthApp(tk);
          const isApiKey = isApiKeyApp(tk);
          const noAction = tk.no_auth;

          return (
            <div key={tk.slug} className="card" style={{
              padding: "var(--space-lg)",
              transition: "all 0.2s",
              ...(connected ? { borderColor: "hsla(152,69%,50%,0.35)" } : {}),
            }}>
              {/* Card header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-sm)" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tk.logo}
                    alt={tk.name}
                    width={36} height={36}
                    style={{ borderRadius: 8, objectFit: "contain", background: "var(--bg-glass)", padding: 2 }}
                    onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(tk.name)}&size=36&background=3b82f6&color=fff&bold=true&length=2`; }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.2 }}>{tk.name}</div>
                    {tk.categories[0] && (
                      <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginTop: 2 }}>{tk.categories[0].replace(/-/g, " ")}</div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                  {connected && <span className="badge badge-green" style={{ fontSize: "0.6rem" }}>✓ Connected</span>}
                  {isOAuth && !connected && <span className="badge" style={{ fontSize: "0.55rem", color: "var(--accent)", borderColor: "var(--accent)", padding: "1px 5px" }}>OAuth</span>}
                  {isApiKey && !connected && <span className="badge" style={{ fontSize: "0.55rem", color: "var(--amber)", borderColor: "var(--amber)", padding: "1px 5px" }}>API Key</span>}
                </div>
              </div>

              {/* Description */}
              <p style={{ fontSize: "0.77rem", color: "var(--text-secondary)", lineHeight: 1.5, minHeight: 34, marginBottom: "var(--space-md)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {tk.description || `Connect to ${tk.name} — ${tk.tools_count} actions available.`}
              </p>

              {/* Connected email */}
              {connected && userEmail && (
                <div style={{ padding: "4px 10px", background: "var(--emerald-bg)", borderRadius: "var(--radius-sm)", fontSize: "0.7rem", color: "var(--emerald)", marginBottom: "var(--space-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  🔒 {userEmail}
                </div>
              )}

              {/* Tools count badge */}
              {tk.tools_count > 0 && (
                <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
                  {tk.tools_count} actions available
                </div>
              )}

              {/* Action button */}
              {connected ? (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", color: "var(--rose)", borderColor: "hsla(0,84%,60%,0.25)" }}
                  onClick={() => handleDisconnect(tk)}>
                  Disconnect
                </button>
              ) : noAction ? (
                <div style={{ padding: "6px 12px", textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)" }}>
                  No auth required
                </div>
              ) : isOAuth ? (
                <button className="btn btn-primary btn-sm" style={{ width: "100%" }}
                  onClick={() => handleConnect(tk)} disabled={isConnecting}>
                  {isConnecting
                    ? <span style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                        <span className="animate-glow" style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "white" }} />
                        Connecting...
                      </span>
                    : "Connect →"}
                </button>
              ) : isApiKey ? (
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", color: "var(--amber)", borderColor: "hsla(38,92%,55%,0.3)" }}
                  onClick={() => handleApiKeyOpen(tk)}>
                  🔑 Add API Key →
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* ── Load More (hidden during search) ── */}
      {nextCursor && !search.trim() && (
        <div style={{ textAlign: "center", marginTop: "var(--space-xl)" }}>
          <button className="btn btn-ghost" onClick={() => loadCatalog(nextCursor)} disabled={loadingMore}>
            {loadingMore ? "Loading..." : `Load more integrations`}
          </button>
        </div>
      )}

      {/* ── Server search indicator ── */}
      {searching && (
        <div style={{ textAlign: "center", marginTop: "var(--space-md)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
          Searching all integrations…
        </div>
      )}

      {/* ── Custom API Connectors ── */}
      <div style={{ marginTop: "var(--space-2xl)", borderTop: "1px solid var(--border)", paddingTop: "var(--space-xl)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-lg)" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>🔌 Custom API Connectors</div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 2 }}>
              Connect any REST API not listed above — agents call it using the <code>custom_api_call</code> tool.
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => { setShowCustomModal(true); setCustomError(null); }}>
            + Add Any API
          </button>
        </div>

        {customConnectors.length === 0 ? (
          <div style={{ padding: "var(--space-lg)", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: "var(--radius)", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            No custom APIs added yet. Click <strong>+ Add Any API</strong> to connect Vapi, your internal CRM, hotel PMS, or any REST service.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--space-md)" }}>
            {customConnectors.map(c => (
              <div key={c.provider} className="card" style={{ padding: "var(--space-md)", borderColor: "hsla(152,69%,50%,0.3)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{c.metadata?.display_name ?? c.provider}</div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>
                      {c.metadata?.base_url ?? "No base URL"} · {c.metadata?.auth_type ?? "bearer"}
                    </div>
                  </div>
                  <span className="badge badge-green" style={{ fontSize: "0.6rem" }}>✓ Connected</span>
                </div>
                <div style={{ marginTop: "var(--space-sm)", fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                  tool: custom_api_call · name: &quot;{c.metadata?.display_name ?? c.provider}&quot;
                </div>
                <button className="btn btn-ghost btn-sm" style={{ width: "100%", marginTop: "var(--space-sm)", fontSize: "0.75rem", color: "var(--rose)" }}
                  onClick={async () => {
                    await fetch(`/api/connectors/custom?provider=${c.provider}`, { method: "DELETE", credentials: "include" });
                    showToast(`✓ ${c.metadata?.display_name ?? c.provider} removed`);
                    fetchCustomConnectors();
                  }}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── API Key Modal ── */}
      {apiKeyModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}
          onClick={() => setApiKeyModal(null)}>
          <div className="card" style={{ width: "100%", maxWidth: 440, padding: "var(--space-xl)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-lg)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={apiKeyModal.logo} alt={apiKeyModal.name} width={36} height={36}
                  style={{ borderRadius: 8, objectFit: "contain", background: "var(--bg-glass)", padding: 2 }}
                  onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(apiKeyModal.name)}&size=36&background=3b82f6&color=fff&bold=true&length=2`; }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: "1rem" }}>Connect {apiKeyModal.name}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>API Key · encrypted at rest</div>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setApiKeyModal(null)}>✕</button>
            </div>

            {keySuccess ? (
              <div style={{ padding: "var(--space-lg)", textAlign: "center" }}>
                <div style={{ fontSize: "2rem", marginBottom: 8 }}>✅</div>
                <div style={{ fontWeight: 700, color: "var(--emerald)" }}>{apiKeyModal.name} Connected!</div>
              </div>
            ) : (
              <>
                <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: 6 }}>
                  {API_KEY_LABELS[apiKeyModal.slug] ?? "API Key"}
                </label>
                <input className="input" type="password" autoComplete="new-password"
                  placeholder={`Paste your ${apiKeyModal.name} API key`}
                  value={apiKeyValue} onChange={e => setApiKeyValue(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !savingKey && handleApiKeySave()}
                  style={{ fontFamily: "monospace", fontSize: "0.85rem", marginBottom: "var(--space-md)" }}
                  disabled={savingKey} />
                {keyAccountInfo && (
                  <div style={{ padding: "var(--space-sm) var(--space-md)", background: "var(--emerald-bg)", borderRadius: "var(--radius-sm)", fontSize: "0.78rem", color: "var(--emerald)", marginBottom: "var(--space-md)" }}>
                    ✓ {keyAccountInfo}
                  </div>
                )}
                {keyError && (
                  <div style={{ padding: "var(--space-sm) var(--space-md)", background: "var(--rose-bg)", borderRadius: "var(--radius-sm)", fontSize: "0.8rem", color: "var(--rose)", marginBottom: "var(--space-md)" }}>
                    ❌ {keyError}
                  </div>
                )}
                <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost" onClick={() => setApiKeyModal(null)} disabled={savingKey}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleApiKeySave} disabled={savingKey || !apiKeyValue.trim()}>
                    {savingKey ? "Saving…" : "Save & Connect →"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Custom Connector Modal ── */}
      {showCustomModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}
          onClick={() => setShowCustomModal(false)}>
          <div className="card" style={{ width: "100%", maxWidth: 460, padding: "var(--space-xl)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-lg)" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>🔌 Add Custom API Connector</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>Connect any REST API — Vapi, hotel PMS, internal tools</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCustomModal(false)}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              {[
                { key: "name", label: "Connector Name", placeholder: "e.g. My Hotel PMS", type: "text" },
                { key: "api_key", label: "API Key / Token", placeholder: "Your secret key", type: "password" },
                { key: "base_url", label: "Base URL (optional)", placeholder: "https://api.example.com", type: "text" },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: 4 }}>{f.label}</label>
                  <input className="input" type={f.type} placeholder={f.placeholder}
                    value={customForm[f.key as keyof typeof customForm]}
                    onChange={e => setCustomForm(p => ({ ...p, [f.key]: e.target.value }))}
                    style={{ fontSize: "0.85rem" }} autoComplete="off" />
                </div>
              ))}
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Auth Type</label>
                <select className="input" value={customForm.auth_type} onChange={e => setCustomForm(p => ({ ...p, auth_type: e.target.value }))} style={{ fontSize: "0.85rem" }}>
                  <option value="bearer">Bearer Token</option>
                  <option value="apikey">API Key Header (X-API-Key)</option>
                  <option value="basic">Basic Auth</option>
                  <option value="token">Token</option>
                </select>
              </div>
            </div>
            {customError && (
              <div style={{ padding: "var(--space-sm)", background: "var(--rose-bg)", borderRadius: "var(--radius-sm)", fontSize: "0.8rem", color: "var(--rose)", marginTop: "var(--space-md)" }}>
                ❌ {customError}
              </div>
            )}
            <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end", marginTop: "var(--space-lg)" }}>
              <button className="btn btn-ghost" onClick={() => setShowCustomModal(false)} disabled={savingCustom}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveCustom} disabled={savingCustom}>
                {savingCustom ? "Saving…" : "Save Connector →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="approval-toast" style={{ background: "var(--accent)", color: "white" }}>{toast}</div>
      )}
    </>
  );
}
