"use client";
import { useState } from "react";

// ============================================================
// Admin Login — Email + Password + OTP (3-step flow)
// ============================================================

export default function AdminLoginPage() {
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mgmt-x7k9/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      setStep("otp");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOTP = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mgmt-x7k9/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify_otp", email, otp }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      window.location.href = "/mgmt-x7k9";
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-lg)" }}>
      <div className="card" style={{ maxWidth: 420, width: "100%", padding: "var(--space-2xl)" }}>
        <div style={{ textAlign: "center", marginBottom: "var(--space-xl)" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-sm)" }}>🔐</div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "var(--space-xs)" }}>Admin Panel</h1>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
            {step === "credentials" ? "Enter your credentials" : "Enter the OTP sent to your email"}
          </p>
        </div>

        {error && (
          <div style={{ padding: "10px 14px", background: "hsla(0,80%,50%,0.1)", border: "1px solid hsla(0,80%,50%,0.3)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-md)", fontSize: "0.82rem", color: "var(--ruby)" }}>
            {error}
          </div>
        )}

        {step === "credentials" ? (
          <>
            <div style={{ marginBottom: "var(--space-md)" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@agenticfactor.io"
                style={{ width: "100%", padding: "10px 14px", background: "var(--bg-glass)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.9rem" }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
            </div>
            <div style={{ marginBottom: "var(--space-lg)" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ width: "100%", padding: "10px 14px", background: "var(--bg-glass)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.9rem" }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleLogin} disabled={loading || !email || !password}>
              {loading ? "Verifying..." : "Login → Send OTP"}
            </button>
          </>
        ) : (
          <>
            <div style={{ marginBottom: "var(--space-md)", textAlign: "center" }}>
              <span style={{ fontSize: "0.82rem", color: "var(--emerald)" }}>✓ OTP sent to {email}</span>
            </div>
            <div style={{ marginBottom: "var(--space-lg)" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: 4 }}>One-Time Password</label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                maxLength={6}
                style={{ width: "100%", padding: "14px", background: "var(--bg-glass)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "1.5rem", textAlign: "center", letterSpacing: "0.3em", fontWeight: 700 }}
                onKeyDown={(e) => e.key === "Enter" && handleOTP()}
                autoFocus
              />
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 6, textAlign: "center" }}>Expires in 5 minutes</p>
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleOTP} disabled={loading || otp.length !== 6}>
              {loading ? "Verifying..." : "Verify OTP"}
            </button>
            <button className="btn btn-ghost" style={{ width: "100%", marginTop: "var(--space-sm)" }} onClick={() => { setStep("credentials"); setOtp(""); }}>
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
