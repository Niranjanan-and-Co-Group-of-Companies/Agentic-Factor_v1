"use client";
import { useState } from "react";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    // Simulate send — in production, wire to /api/contact or SMTP2GO
    await new Promise(r => setTimeout(r, 1500));
    setSent(true);
    setSending(false);
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
              <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem" }}>We&apos;ll get back to you within 24 hours.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label className="input-label">Name</label>
                <input className="input" placeholder="Your name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
              </div>
              <div>
                <label className="input-label">Email</label>
                <input className="input" type="email" placeholder="you@company.com" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required />
              </div>
              <div>
                <label className="input-label">Subject</label>
                <input className="input" placeholder="How can we help?" value={form.subject} onChange={e => setForm({...form, subject: e.target.value})} required />
              </div>
              <div>
                <label className="input-label">Message</label>
                <textarea className="textarea" placeholder="Tell us more..." value={form.message} onChange={e => setForm({...form, message: e.target.value})} required style={{ minHeight: 100 }} />
              </div>
              <button className="btn btn-primary" type="submit" disabled={sending} style={{ width: "100%" }}>
                {sending ? "Sending..." : "Send Message"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
