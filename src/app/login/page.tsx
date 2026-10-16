"use client";
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Lock, ShieldCheck, Eye, History } from "lucide-react";
import Logo from "@/components/brand/Logo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // /signup and links with ?mode=signup open the form in sign-up mode.
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("mode") === "signup") setMode("signup");
  }, []);

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
          setSuccess("Account created. Check your email for a confirmation link.");
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
    <div className="login-shell">
      <style>{`
        .login-shell { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr); background: var(--bg-primary); }
        .login-aside { background: var(--bg-ink); color: #F2EDE5; padding: 48px clamp(32px, 5vw, 72px); display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden; }
        .login-aside h1 { font-family: var(--font-display); font-weight: 400; font-size: clamp(2.6rem, 4.4vw, 4rem); line-height: 1; letter-spacing: -0.02em; margin-top: 12vh; }
        .login-aside h1 em { color: #F08457; }
        .login-aside p { color: #C9C1B5; font-size: 1.05rem; line-height: 1.6; margin-top: 20px; max-width: 26em; }
        .login-points { display: flex; flex-direction: column; gap: 14px; margin-top: 40px; }
        .login-point { display: flex; gap: 12px; align-items: flex-start; color: #DDD6CB; font-size: 0.95rem; line-height: 1.5; }
        .login-point svg { color: #F08457; flex-shrink: 0; margin-top: 2px; }
        .login-aside small { color: #8F877C; font-size: 0.8rem; }
        .login-main { display: flex; align-items: center; justify-content: center; padding: var(--space-2xl); }
        .login-form { width: 100%; max-width: 400px; }
        .login-title { font-family: var(--font-display); font-weight: 400; font-size: 2.4rem; line-height: 1.05; letter-spacing: -0.01em; }
        .login-sub { color: var(--text-secondary); margin-top: 8px; font-size: 0.95rem; }
        .login-divider { display: flex; align-items: center; gap: var(--space-md); margin: var(--space-lg) 0; font-size: 0.8rem; color: var(--text-muted); }
        .login-divider::before, .login-divider::after { content: ""; flex: 1; height: 1px; background: var(--border); }
        .login-note { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: var(--space-lg); font-size: 0.78rem; color: var(--text-muted); }
        .login-msg { display: flex; gap: 8px; align-items: flex-start; margin-bottom: var(--space-md); padding: 10px 12px; border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.45; }
        .login-msg svg { flex-shrink: 0; margin-top: 1px; }
        .login-spin { animation: spin 0.9s linear infinite; }
        .login-mobile-logo { display: none; }
        @media (max-width: 900px) { .login-shell { grid-template-columns: 1fr; } .login-aside { display: none; } .login-mobile-logo { display: block; } }
      `}</style>

      <aside className="login-aside" aria-hidden>
        <div>
          {/* The mark inverts on ink: paper tile, ink bars. */}
          <span style={{ ["--text-primary" as string]: "#F2EDE5", ["--bg-primary" as string]: "#1B1814", ["--accent" as string]: "#F08457", display: "inline-flex" }}>
            <Logo size={28} />
          </span>
          <h1>Describe the work.<br />Agents do <em>the rest.</em></h1>
          <p>Turn a plain-language request into a team of AI agents that works across your apps — and asks before it changes anything that matters.</p>
          <div className="login-points">
            <div className="login-point"><Eye size={17} strokeWidth={1.75} /> Every mission is rehearsed before it touches real data.</div>
            <div className="login-point"><ShieldCheck size={17} strokeWidth={1.75} /> Emails, payments and deletions wait for your approval.</div>
            <div className="login-point"><History size={17} strokeWidth={1.75} /> A full record of every run and every change.</div>
          </div>
        </div>
        <small>© {new Date().getFullYear()} Agentic Factor</small>
      </aside>

      <main className="login-main login-wrap">
        <div className="login-form">
          <div className="login-mobile-logo" style={{ marginBottom: "var(--space-xl)" }}>
            <a href="/" aria-label="Agentic Factor — home" style={{ textDecoration: "none" }}><Logo size={28} /></a>
          </div>
          <h2 className="login-title">{mode === "login" ? "Welcome back." : "Create your account."}</h2>
          <p className="login-sub">{mode === "login" ? "Sign in to your Command Center." : "Start with 30 free credits. No credit card required."}</p>

          <div style={{ marginTop: "var(--space-xl)" }}>
            <button
              className="oauth-btn"
              onClick={handleGoogleLogin}
              disabled={googleLoading}
              style={{ justifyContent: "center", gap: 12 }}
            >
              {googleLoading ? (
                <LoaderCircle size={18} className="login-spin" aria-hidden />
              ) : (
                <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
              )}
              <span style={{ fontWeight: 600, fontSize: "0.95rem", flex: "none" }}>
                {googleLoading ? "Connecting…" : "Continue with Google"}
              </span>
            </button>
          </div>

          <div className="login-divider">or with email</div>

          <div style={{ marginBottom: "var(--space-md)" }}>
            <label className="input-label" htmlFor="auth-email">Email</label>
            <input
              id="auth-email" className="input" type="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com" autoComplete="email"
              onKeyDown={(e) => e.key === "Enter" && handleEmailAuth()}
            />
          </div>
          <div style={{ marginBottom: "var(--space-lg)" }}>
            <label className="input-label" htmlFor="auth-password">Password</label>
            <input
              id="auth-password" className="input" type="password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"}
              onKeyDown={(e) => e.key === "Enter" && handleEmailAuth()}
            />
            {mode === "signup" && (
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>At least 6 characters</p>
            )}
          </div>

          {error && (
            <div className="login-msg" role="alert" style={{ background: "var(--rose-bg)", color: "var(--rose)" }}>
              <AlertCircle size={16} /> <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="login-msg" role="status" style={{ background: "var(--emerald-bg)", color: "var(--emerald)" }}>
              <CheckCircle2 size={16} /> <span>{success}</span>
            </div>
          )}

          <button className="btn btn-primary btn-lg" style={{ width: "100%" }} onClick={handleEmailAuth} disabled={loading}>
            {loading ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                <LoaderCircle size={16} className="login-spin" aria-hidden />
                {mode === "login" ? "Signing in…" : "Creating account…"}
              </span>
            ) : mode === "login" ? "Sign in" : "Create account"}
          </button>

          <div style={{ textAlign: "center", marginTop: "var(--space-md)" }}>
            <button
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setSuccess(""); }}
              style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.88rem", fontFamily: "var(--font-sans)" }}
            >
              {mode === "login" ? <>New here? <span style={{ color: "var(--accent)", fontWeight: 600 }}>Create an account</span></> : <>Already have an account? <span style={{ color: "var(--accent)", fontWeight: 600 }}>Sign in</span></>}
            </button>
          </div>

          <div className="login-note"><Lock size={13} strokeWidth={1.75} aria-hidden /> Encrypted credentials · isolated workspaces · row-level security</div>
        </div>
      </main>
    </div>
  );
}
