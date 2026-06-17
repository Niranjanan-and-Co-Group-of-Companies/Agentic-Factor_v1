"use client";
import { useState } from "react";

export default function ContactPage() {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  // React 19 form action — receives FormData, no synthetic event needed
  const handleSubmit = async (formData: FormData) => {
    setSending(true);
    setError("");

    const name    = (formData.get("name")    as string)?.trim();
    const email   = (formData.get("email")   as string)?.trim();
    const subject = (formData.get("subject") as string)?.trim();
    const message = (formData.get("message") as string)?.trim();

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      setSent(true);
    } catch {
      setError("Network error. Please email us directly at hello@agenticfactor.io.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="welcome-section" style={{ maxWidth: 800 }}>
      <h1 className="welcome-section-title" style={{ textAlign: "left", fontSize: "1.5rem", marginBottom: 12 }}>💬 Contact Us</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: 32, lineHeight: 1.7 }}>
        Have a question, need support, or want to discuss enterprise plans? Reach out and we&apos;ll get back to you within 24 hours.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
        {/* Contact Info */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>📧</div>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 4 }}>Email</h3>
            <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)", fontSize: "0.88rem", textDecoration: "none" }}>hello@agenticfactor.io</a>
          </div>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>🏢</div>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 4 }}>Enterprise Sales</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: 1.6 }}>
              Custom plans, SLA, dedicated support, and volume pricing.
            </p>
            <a href="mailto:enterprise@agenticfactor.io" style={{ color: "var(--accent)", fontSize: "0.85rem", textDecoration: "none", marginTop: 8, display: "inline-block" }}>enterprise@agenticfactor.io</a>
          </div>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>⏰</div>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 4 }}>Response Time</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>We typically respond within 24 hours on business days.</p>
          </div>
        </div>

        {/* Contact Form */}
        <div className="card" style={{ padding: 28 }}>
          {sent ? (
            <div style={{ textAlign: "center", padding: 32 }}>
              <div style={{ fontSize: "3rem", marginBottom: 12 }}>✅</div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 8 }}>Message Sent!</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", lineHeight: 1.6 }}>
                We&apos;ll get back to you within 24 hours. Check your inbox — we&apos;ve sent you a confirmation email.
              </p>
            </div>
          ) : (
            <form action={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label className="input-label">Name</label>
                <input className="input" name="name" placeholder="Your name" required maxLength={120} />
              </div>
              <div>
                <label className="input-label">Email</label>
                <input className="input" name="email" type="email" placeholder="you@company.com" required maxLength={254} />
              </div>
              <div>
                <label className="input-label">Subject</label>
                <input className="input" name="subject" placeholder="How can we help?" required maxLength={200} />
              </div>
              <div>
                <label className="input-label">Message</label>
                <textarea className="textarea" name="message" placeholder="Tell us more..." required maxLength={5000} style={{ minHeight: 100 }} />
              </div>

              {error && (
                <p style={{ fontSize: "0.82rem", color: "var(--ruby, #ef4444)", margin: 0, lineHeight: 1.5 }}>
                  {error}
                </p>
              )}

              <button className="btn btn-primary" type="submit" disabled={sending} style={{ width: "100%" }}>
                {sending ? "Sending…" : "Send Message"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
