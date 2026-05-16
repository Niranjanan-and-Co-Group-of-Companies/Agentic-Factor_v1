"use client";
import { useEffect, useRef } from "react";

// ============================================================
// Welcome / Landing Page — Premium scrolling marketing page
// Section order: Hero, How It Works, For Individuals, For Companies,
// Features, Pricing, CTA Banner, Testimonials, FAQ
// ============================================================

const FEATURES = [
  { icon: "🤖", title: "AI Agent Teams", desc: "Autonomous multi-agent systems that decompose and execute complex goals" },
  { icon: "🧠", title: "Powered by Claude", desc: "Claude Sonnet 4 for best code generation, with Gemini & GPT fallback" },
  { icon: "🔌", title: "40+ Connectors", desc: "Google, Slack, Notion, GitHub, Zoho, Discord and more" },
  { icon: "📚", title: "RAG Memory", desc: "Vector-powered knowledge base with PDF/DOCX ingestion" },
  { icon: "⚡", title: "E2B Sandboxing", desc: "Secure code execution in isolated cloud environments" },
  { icon: "💳", title: "Credit-Based Billing", desc: "Pay only for what your agents consume — no waste" },
  { icon: "🔒", title: "Enterprise Security", desc: "AES-256 encryption, RLS, OAuth 2.0, RBAC governance" },
  { icon: "📊", title: "Real-Time Dashboard", desc: "Live agent status, token usage, mission timeline" },
  { icon: "📧", title: "Agent Email Inbox", desc: "Email your agents tasks — they read, process, and reply" },
];

const PLANS = [
  { name: "Free Trial", price: "₹0", period: "", credits: "30 credits", features: ["1 active mission", "Flash models (Gemini Flash, Claude Haiku)", "100 MB storage", "2 discovery questions", "No scheduling", "No multi-role agents"], cta: "Start Free", href: "/login", highlight: false },
  { name: "Individual", price: "₹2,499", period: "/month", credits: "1,000 credits", features: ["5 active missions", "Pro models (Claude Sonnet, GPT-4o)", "10 GB storage", "3-4 discovery questions", "Agent email inbox", "Up to 2 parallel roles"], cta: "Upgrade", href: "/pricing", highlight: true },
  { name: "Pro", price: "From ₹4,548", period: "/month", credits: "1,000 credits/seat", features: ["50 active missions", "All models (Claude Sonnet 4, Gemini, GPT)", "100 GB storage", "5-6 discovery questions", "Unlimited multi-role agents", "Credit top-ups available"], cta: "Configure", href: "/pricing", highlight: false },
  { name: "Enterprise", price: "Custom", period: "", credits: "Unlimited credits", features: ["Unlimited missions", "All + custom fine-tuned models", "1 TB storage", "8-10 discovery questions", "Dedicated support"], cta: "Contact Sales", href: "/contact", highlight: false },
];

const TESTIMONIALS = [
  { name: "Priya Sharma", role: "Marketing Lead, TechCorp", text: "Agentic Factor transformed how we manage our social media campaigns. The AI agents handle everything from content research to posting schedules.", avatar: "PS" },
  { name: "Rahul Mehta", role: "CTO, DataVista", text: "We deployed 15 agents in a week — monitoring infrastructure, processing reports, and routing Slack alerts. Incredible time savings.", avatar: "RM" },
  { name: "Ananya Gupta", role: "Founder, CreativeHQ", text: "The blueprint system is genius. I describe what I need and the AI designs the perfect team. It's like having a solutions architect on demand.", avatar: "AG" },
  { name: "Vikram Patel", role: "VP Engineering, ScaleUp Inc", text: "Enterprise-grade security with startup-level speed. Our compliance team approved it in days, not months.", avatar: "VP" },
];

const FAQS = [
  { q: "What is Agentic Factor?", a: "Agentic Factor is a SaaS platform that lets you design, deploy, and manage autonomous AI agent teams. You describe a mission in plain English, and our AI builds a team of specialized agents to execute it." },
  { q: "How do credits work?", a: "Every agent action (LLM call, code execution, file processing) costs credits from your pool. Free trial gives you 30 credits. Paid plans refill monthly. You only pay for what your agents consume." },
  { q: "Is my data secure?", a: "Absolutely. All credentials are AES-256-GCM encrypted. We use Supabase Row Level Security, OAuth 2.0, and isolated E2B sandboxes for code execution. Your data never leaves your tenant." },
  { q: "Can I connect my own tools?", a: "Yes! We support 40+ connectors including Google, Slack, GitHub, Notion, Zoho, and Discord. Need a custom connector? Request it from the dashboard and our team will set it up." },
  { q: "What happens when I run out of credits?", a: "Agents will pause and notify you. You can upgrade your plan or wait for the monthly refill. No data is lost." },
  { q: "Do you offer refunds?", a: "All sales are final. Credits are non-refundable. Cancelling your plan stops future billing but doesn't refund the current period." },
];

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.style.opacity = "1";
          el.style.transform = "translateY(0)";
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function ScrollSection({ children, id }: { children: React.ReactNode; id?: string }) {
  const ref = useScrollReveal();
  return (
    <div ref={ref} id={id} className="welcome-section" style={{ opacity: 0, transform: "translateY(30px)", transition: "all 0.7s cubic-bezier(0.4, 0, 0.2, 1)" }}>
      {children}
    </div>
  );
}

export default function WelcomePage() {
  return (
    <>
      {/* ═══════ SECTION 1: HERO ═══════ */}
      <section style={{ position: "relative", overflow: "hidden", padding: "100px 24px 80px", textAlign: "center" }}>
        {/* Animated gradient BG */}
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 30% 20%, hsla(217,91%,60%,0.12) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, hsla(270,70%,60%,0.08) 0%, transparent 60%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", maxWidth: 800, margin: "0 auto" }}>
          <div style={{ display: "inline-block", padding: "4px 16px", borderRadius: 99, background: "hsla(217,91%,60%,0.1)", border: "1px solid hsla(217,91%,60%,0.2)", fontSize: "0.78rem", fontWeight: 600, color: "hsl(217,91%,60%)", marginBottom: 24, letterSpacing: "0.5px" }}>
            🚀 Now in Public Beta
          </div>
          <h1 style={{ fontSize: "clamp(2.2rem, 5vw, 3.5rem)", fontWeight: 800, lineHeight: 1.15, letterSpacing: "-1px", marginBottom: 20 }}>
            Build <span style={{ background: "linear-gradient(135deg, hsl(217,91%,60%), hsl(270,70%,60%))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Autonomous AI</span> Agent Teams
          </h1>
          <p style={{ fontSize: "1.1rem", color: "hsl(215,15%,60%)", lineHeight: 1.7, maxWidth: 600, margin: "0 auto 32px" }}>
            Describe your mission in plain English. Our AI designs the optimal agent team, builds the blueprint, and executes autonomously — with human-in-the-loop approval.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <a href="/dashboard" className="btn btn-primary btn-lg" style={{ fontSize: "1rem", padding: "14px 32px" }}>🎯 Test Me Free</a>
            <a href="/signup" className="btn btn-ghost btn-lg" style={{ fontSize: "1rem", padding: "14px 32px" }}>Create Account →</a>
          </div>
        </div>
      </section>

      {/* ═══════ SECTION 2: HOW IT WORKS ═══════ */}
      <ScrollSection id="how-it-works">
        <h2 className="welcome-section-title">How It Works</h2>
        <p className="welcome-section-subtitle">Three steps from idea to autonomous execution</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
          {[
            { step: "01", icon: "💬", title: "Describe Your Mission", desc: "Tell us what you need in natural language. Our AI asks smart clarifying questions to understand exactly what you want." },
            { step: "02", icon: "🏗️", title: "Review the Blueprint", desc: "AI designs an optimal team of specialized agents — with roles, tools, scripts, and orchestration. Edit before deploying." },
            { step: "03", icon: "⚡", title: "Agents Execute", desc: "Your agents run autonomously in secure sandboxes, requesting approval when needed. Get real-time progress in the dashboard." },
          ].map(s => (
            <div key={s.step} className="card" style={{ textAlign: "center", padding: 32, position: "relative" }}>
              <div style={{ position: "absolute", top: 16, left: 20, fontSize: "0.7rem", fontWeight: 800, color: "hsl(217,91%,60%)", letterSpacing: 1 }}>{s.step}</div>
              <div style={{ fontSize: "2.5rem", marginBottom: 16 }}>{s.icon}</div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 8 }}>{s.title}</h3>
              <p style={{ fontSize: "0.85rem", color: "hsl(215,15%,60%)", lineHeight: 1.7 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </ScrollSection>

      {/* ═══════ SECTION 3: FOR INDIVIDUALS ═══════ */}
      <ScrollSection id="for-individuals">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "hsl(152,69%,50%)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>For Individuals</div>
            <h2 style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 16 }}>Your Personal AI Workforce</h2>
            <p style={{ fontSize: "0.9rem", color: "hsl(215,15%,60%)", lineHeight: 1.8, marginBottom: 24 }}>
              Automate research, content creation, data analysis, and monitoring tasks. One person, unlimited output. Deploy agents for social media analysis, lead generation, competitor monitoring, and more.
            </p>
            <a href="/dashboard" className="btn btn-primary">🎯 Try It Now</a>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden", aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, hsla(152,69%,50%,0.05), hsla(217,91%,60%,0.05))" }}>
            {/* Video placeholder */}
            <div style={{ textAlign: "center", color: "hsl(215,15%,60%)" }}>
              <div style={{ fontSize: "3rem", marginBottom: 8 }}>▶️</div>
              <p style={{ fontSize: "0.85rem" }}>Demo Video — Coming Soon</p>
            </div>
          </div>
        </div>
      </ScrollSection>

      {/* ═══════ SECTION 4: FOR COMPANIES ═══════ */}
      <ScrollSection id="for-companies">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "center" }}>
          <div className="card" style={{ padding: 0, overflow: "hidden", aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, hsla(270,70%,60%,0.05), hsla(217,91%,60%,0.05))" }}>
            <div style={{ textAlign: "center", color: "hsl(215,15%,60%)" }}>
              <div style={{ fontSize: "3rem", marginBottom: 8 }}>▶️</div>
              <p style={{ fontSize: "0.85rem" }}>Enterprise Demo — Coming Soon</p>
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "hsl(270,70%,60%)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>For Companies</div>
            <h2 style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 16 }}>Scale Your Operations with AI</h2>
            <p style={{ fontSize: "0.9rem", color: "hsl(215,15%,60%)", lineHeight: 1.8, marginBottom: 24 }}>
              Deploy agent teams across departments — marketing, engineering, sales, support. Multi-seat licensing, RBAC governance, full audit trails, and Zoho/Google/Slack integrations for your entire organization.
            </p>
            <a href="/contact" className="btn btn-primary">📞 Contact Sales</a>
          </div>
        </div>
      </ScrollSection>

      {/* ═══════ SECTION 5: FEATURES GRID ═══════ */}
      <ScrollSection id="features">
        <h2 className="welcome-section-title">Everything You Need</h2>
        <p className="welcome-section-subtitle">Enterprise-grade capabilities at every tier</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
          {FEATURES.map(f => (
            <div key={f.title} className="card" style={{ padding: 24 }}>
              <div style={{ fontSize: "1.8rem", marginBottom: 12 }}>{f.icon}</div>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 6 }}>{f.title}</h3>
              <p style={{ fontSize: "0.82rem", color: "hsl(215,15%,60%)", lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </ScrollSection>

      {/* ═══════ SECTION 6: PRICING ═══════ */}
      <ScrollSection id="pricing">
        <h2 className="welcome-section-title">Simple, Credit-Based Pricing</h2>
        <p className="welcome-section-subtitle">Powered by Claude, Gemini & GPT. Pay for what your agents consume.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 20 }}>
          {PLANS.map(p => (
            <div key={p.name} className="card" style={{ padding: 28, position: "relative", border: p.highlight ? "1px solid hsl(217,91%,60%)" : undefined, boxShadow: p.highlight ? "0 0 30px hsla(217,91%,60%,0.15)" : undefined }}>
              {p.highlight && <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg, hsl(217,91%,60%), hsl(230,80%,55%))", color: "white", padding: "3px 14px", borderRadius: 99, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.5px" }}>MOST POPULAR</div>}
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>{p.name}</h3>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: "1.8rem", fontWeight: 800 }}>{p.price}</span>
                <span style={{ fontSize: "0.8rem", color: "hsl(215,15%,60%)" }}>{p.period}</span>
              </div>
              <div style={{ fontSize: "0.78rem", color: "hsl(217,91%,60%)", fontWeight: 600, marginBottom: 16 }}>{p.credits}</div>
              <ul style={{ listStyle: "none", padding: 0, marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                {p.features.map(f => (
                  <li key={f} style={{ fontSize: "0.82rem", color: "hsl(215,15%,60%)", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "hsl(152,69%,50%)", fontSize: "0.9rem" }}>✓</span> {f}
                  </li>
                ))}
              </ul>
              <a href={p.href} className={`btn ${p.highlight ? "btn-primary" : "btn-ghost"}`} style={{ width: "100%", textAlign: "center", textDecoration: "none" }}>
                {p.cta}
              </a>
            </div>
          ))}
        </div>
      </ScrollSection>

      {/* ═══════ SECTION 7: CTA BANNER ═══════ */}
      <ScrollSection>
        <div style={{ background: "linear-gradient(135deg, hsla(217,91%,60%,0.1), hsla(270,70%,60%,0.08))", border: "1px solid hsla(217,91%,60%,0.2)", borderRadius: 20, padding: "48px 32px", textAlign: "center" }}>
          <h2 style={{ fontSize: "1.6rem", fontWeight: 800, marginBottom: 12 }}>Ready to Build Your AI Team?</h2>
          <p style={{ color: "hsl(215,15%,60%)", fontSize: "0.95rem", marginBottom: 24, maxWidth: 500, margin: "0 auto 24px" }}>
            Start with 50 free credits. No credit card required.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <a href="/signup" className="btn btn-primary btn-lg" style={{ textDecoration: "none" }}>Create Free Account</a>
            <a href="/dashboard" className="btn btn-ghost btn-lg" style={{ textDecoration: "none" }}>🎯 Test Me</a>
          </div>
        </div>
      </ScrollSection>

      {/* ═══════ SECTION 8: TESTIMONIALS ═══════ */}
      <ScrollSection id="testimonials">
        <h2 className="welcome-section-title">What People Are Saying</h2>
        <p className="welcome-section-subtitle">Trusted by teams building the future with AI</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {TESTIMONIALS.map(t => (
            <div key={t.name} className="card" style={{ padding: 24 }}>
              <p style={{ fontSize: "0.88rem", color: "hsl(215,15%,60%)", lineHeight: 1.7, marginBottom: 16, fontStyle: "italic" }}>&ldquo;{t.text}&rdquo;</p>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, hsl(217,91%,60%), hsl(270,70%,60%))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: "0.8rem", flexShrink: 0 }}>
                  {t.avatar}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{t.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "hsl(215,15%,60%)" }}>{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollSection>

      {/* ═══════ SECTION 9: FAQ ═══════ */}
      <ScrollSection id="faq">
        <h2 className="welcome-section-title">Frequently Asked Questions</h2>
        <p className="welcome-section-subtitle">Everything you need to know</p>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {FAQS.map(f => (
            <details key={f.q} className="card" style={{ padding: "16px 24px", cursor: "pointer" }}>
              <summary style={{ fontWeight: 600, fontSize: "0.92rem", listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {f.q} <span style={{ color: "hsl(217,91%,60%)", fontSize: "1.2rem" }}>+</span>
              </summary>
              <p style={{ marginTop: 12, fontSize: "0.85rem", color: "hsl(215,15%,60%)", lineHeight: 1.7 }}>{f.a}</p>
            </details>
          ))}
        </div>
      </ScrollSection>

      <div style={{ height: 48 }} />
    </>
  );
}
