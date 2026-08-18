"use client";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const getSupabase = async () => {
    const { createBrowserClient } = await import("@supabase/ssr");
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true); setError("");
    try {
      const supabase = await getSupabase();
      const returnTo = new URL(window.location.href).searchParams.get("returnTo") || "/dashboard";
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}` },
      });
      if (oauthErr) throw oauthErr;
    } catch (err) {
      setError((err as Error).message);
      setGoogleLoading(false);
    }
  };

  const handleEmailAuth = async () => {
    if (!email || !password) { setError("Email and password are required."); return; }
    if (mode === "signup" && password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true); setError(""); setSuccess("");
    try {
      const supabase = await getSupabase();
      if (mode === "login") {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) throw signInErr;
        const returnTo = new URL(window.location.href).searchParams.get("returnTo") || "/dashboard";
        window.location.href = returnTo;
      } else {
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (signUpErr) throw signUpErr;
        if (data.user?.identities?.length === 0) {
          setError("An account with this email already exists. Try signing in instead.");
        } else {
          setSuccess("✅ Account created! Check your email for a confirmation link.");
          fetch("/api/auth/welcome-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, name: email.split("@")[0] }),
          }).catch(() => {});
        }
      }
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "var(--space-2xl)" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "var(--space-2xl)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Agentic Factor" style={{ width: "100%", maxWidth: "260px", height: "auto", marginBottom: "var(--space-sm)" }} />
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
            AI agents that run your business, hands-free.
          </p>
        </div>

        {/* Google OAuth */}
        <div className="card" style={{ marginBottom: "var(--space-lg)", padding: "var(--space-md)" }}>
          <button
            className="oauth-btn"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            style={{ justifyContent: "center", gap: 12 }}
          >
            {googleLoading ? (
              <span className="animate-glow" style={{ display: "inline-block", width: 20, height: 20, borderRadius: "50%", background: "var(--accent)" }} />
            ) : (
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
            )}
            <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
              {googleLoading ? "Connecting…" : "Continue with Google"}
            </span>
          </button>
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
            <input
              id="auth-email" className="input" type="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              onKeyDown={(e) => e.key === "Enter" && handleEmailAuth()}
            />
          </div>
          <div style={{ marginBottom: "var(--space-lg)" }}>
            <label className="input-label" htmlFor="auth-password">Password</label>
            <input
              id="auth-password" className="input" type="password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={(e) => e.key === "Enter" && handleEmailAuth()}
            />
            {mode === "signup" && (
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 4 }}>Min 6 characters</p>
            )}
          </div>

          {error && (
            <div style={{ marginBottom: "var(--space-md)", padding: "var(--space-sm) var(--space-md)", background: "var(--rose-bg)", borderRadius: "var(--radius-sm)", color: "var(--rose)", fontSize: "0.82rem" }}>
              ❌ {error}
            </div>
          )}
          {success && (
            <div style={{ marginBottom: "var(--space-md)", padding: "var(--space-sm) var(--space-md)", background: "var(--emerald-bg)", borderRadius: "var(--radius-sm)", color: "var(--emerald)", fontSize: "0.82rem" }}>
              {success}
            </div>
          )}

          <button className="btn btn-primary btn-lg" style={{ width: "100%" }} onClick={handleEmailAuth} disabled={loading}>
            {loading ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                <span className="animate-glow" style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", background: "white" }} />
                {mode === "login" ? "Signing In…" : "Creating Account…"}
              </span>
            ) : mode === "login" ? "Sign In" : "Create Account"}
          </button>

          <div style={{ textAlign: "center", marginTop: "var(--space-md)" }}>
            <button
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setSuccess(""); }}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "0.85rem", fontFamily: "var(--font-sans)" }}
            >
              {mode === "login" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>

        {/* Security note */}
        <div style={{ textAlign: "center", marginTop: "var(--space-lg)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          🔒 Enterprise-grade security · Row Level Security enforced · AES-256-GCM vault
        </div>
      </div>
    </div>
  );
}
