"use client";
import { useState } from "react";

// ============================================================
// Login Page — Supabase Auth + OAuth
// Google is live. LinkedIn/Slack/AWS show maintenance toast.
// ============================================================

interface OAuthOption {
  provider: string;
  label: string;
  icon: string;
  enabled: boolean; // Only Google is live
}

const PROVIDERS: OAuthOption[] = [
  { provider: "google", label: "Google (Gmail)", icon: "📧", enabled: true },
  { provider: "linkedin_oidc", label: "LinkedIn", icon: "💼", enabled: false },
  { provider: "slack_oidc", label: "Slack", icon: "💬", enabled: false },
  { provider: "azure", label: "AWS / Azure", icon: "☁️", enabled: false },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleEmailAuth = async () => {
    if (!email || !password) { setError("Email and password are required."); return; }
    if (mode === "signup" && password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true); setError(""); setSuccess("");
    try {
      const { createBrowserClient } = await import("@supabase/ssr");
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const returnTo = new URL(window.location.href).searchParams.get("returnTo") || "/dashboard";
        window.location.href = returnTo;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (data.user?.identities?.length === 0) {
          setError("An account with this email already exists. Try signing in instead.");
        } else {
          setSuccess("✅ Account created! Check your email for a confirmation link.");
        }
      }
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  const handleOAuth = async (provider: string, enabled: boolean) => {
    if (!enabled) {
      showToast(`🔧 ${provider.replace("_oidc", "").replace("azure", "AWS/Azure")} is in maintenance mode. Enable it in Supabase Dashboard → Authentication → Providers.`);
      return;
    }

    setLoadingProvider(provider); setError("");
    try {
      const { createBrowserClient } = await import("@supabase/ssr");
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const returnTo = new URL(window.location.href).searchParams.get("returnTo") || "/dashboard";
      // Pass redirectTo with the auth/callback URL to trigger Guest→User migration
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider as "google" | "linkedin_oidc" | "slack_oidc" | "azure",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError((err as Error).message);
      setLoadingProvider(null);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "var(--space-2xl)" }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "var(--space-2xl)" }}>
          <img src="/logo.png" alt="Agentic Factor" width={64} height={64} style={{ marginBottom: "var(--space-sm)" }} />
          <h1 style={{ fontSize: "1.8rem", fontWeight: 800, background: "linear-gradient(135deg, var(--accent), var(--purple))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Agentic Factor
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-xs)" }}>
            Multi-agent teams from natural language
          </p>
        </div>

        {/* OAuth Buttons */}
        <div className="card" style={{ marginBottom: "var(--space-lg)" }}>
          <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "var(--space-md)", color: "var(--text-secondary)" }}>
            One-Click Sign In
          </p>
          <div className="stack" style={{ gap: "var(--space-sm)" }}>
            {PROVIDERS.map((p) => (
              <button key={p.provider} className="oauth-btn" onClick={() => handleOAuth(p.provider, p.enabled)}
                disabled={loadingProvider === p.provider}
                style={!p.enabled ? { opacity: 0.6 } : undefined}>
                <span className="oauth-icon">{p.icon}</span>
                <span className="oauth-name">{p.label}</span>
                {loadingProvider === p.provider ? (
                  <span className="animate-glow" style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: "var(--accent)" }} />
                ) : !p.enabled ? (
                  <span style={{ fontSize: "0.65rem", color: "var(--amber)" }}>🔧 setup</span>
                ) : (
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>→</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", marginBottom: "var(--space-lg)" }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>or continue with email</span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        {/* Email/Password Form */}
        <div className="card">
          <div style={{ marginBottom: "var(--space-md)" }}>
            <label className="input-label" htmlFor="auth-email">Email</label>
            <input id="auth-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com" onKeyDown={(e) => e.key === "Enter" && handleEmailAuth()} />
          </div>
          <div style={{ marginBottom: "var(--space-lg)" }}>
            <label className="input-label" htmlFor="auth-password">Password</label>
            <input id="auth-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && handleEmailAuth()} />
            {mode === "signup" && (
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "4px" }}>Min 6 characters</p>
            )}
          </div>

          {error && <div style={{ marginBottom: "var(--space-md)", padding: "var(--space-sm) var(--space-md)", background: "var(--rose-bg)", borderRadius: "var(--radius-sm)", color: "var(--rose)", fontSize: "0.82rem" }}>❌ {error}</div>}
          {success && <div style={{ marginBottom: "var(--space-md)", padding: "var(--space-sm) var(--space-md)", background: "var(--emerald-bg)", borderRadius: "var(--radius-sm)", color: "var(--emerald)", fontSize: "0.82rem" }}>{success}</div>}

          <button className="btn btn-primary btn-lg" style={{ width: "100%" }} onClick={handleEmailAuth} disabled={loading}>
            {loading ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                <span className="animate-glow" style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", background: "white" }} />
                {mode === "login" ? "Signing In..." : "Creating Account..."}
              </span>
            ) : mode === "login" ? "Sign In" : "Create Account"}
          </button>

          <div style={{ textAlign: "center", marginTop: "var(--space-md)" }}>
            <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setSuccess(""); }}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "0.85rem", fontFamily: "var(--font-sans)" }}>
              {mode === "login" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>

        {/* Security note */}
        <div style={{ textAlign: "center", marginTop: "var(--space-lg)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          🔒 Secured by Supabase Auth · Row Level Security enforced · AES-256-GCM vault
        </div>
      </div>

      {/* Maintenance Toast */}
      {toast && (
        <div className="approval-toast" style={{ background: "var(--amber)", color: "hsl(222, 25%, 10%)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
