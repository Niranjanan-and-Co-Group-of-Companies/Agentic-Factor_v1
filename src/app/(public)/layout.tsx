import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agentic Factor — Build Autonomous AI Agent Teams",
  description: "Design, deploy, and manage autonomous AI agent teams that execute complex missions. Credit-based pricing, 40+ connectors, enterprise-ready.",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-layout">
      {/* Sticky Top Navbar */}
      <nav className="public-navbar">
        <div className="public-navbar-inner">
          <a href="/" className="public-logo">
            <img src="/logo.png" alt="Agentic Factor" style={{ height: "40px", width: "auto" }} />
          </a>
          <div className="public-nav-links">
            <a href="/pricing" className="public-nav-link">Pricing</a>
            <a href="/terms" className="public-nav-link">Terms</a>
            <a href="/dashboard" className="public-nav-link public-nav-cta-ghost">Test Me</a>
            <a href="/signup" className="public-nav-link public-nav-cta-ghost">Sign Up</a>
            <a href="/login" className="public-nav-link public-nav-cta">Log In</a>
          </div>
          {/* Mobile hamburger */}
          <button className="public-mobile-menu" id="mobile-menu-btn" aria-label="Menu">☰</button>
        </div>
      </nav>

      {/* Page content */}
      <main className="public-main">
        {children}
      </main>

      {/* Footer */}
      <footer className="public-footer">
        <div className="public-footer-inner">
          <div className="public-footer-brand">
            <img src="/logo.png" alt="Agentic Factor" style={{ height: "48px", width: "auto", marginBottom: "var(--space-sm)" }} />
            <p className="public-footer-tagline">Build autonomous AI agent teams that execute complex missions.</p>
          </div>
          <div className="public-footer-links">
            <div className="public-footer-col">
              <h4>Product</h4>
              <a href="/pricing">Pricing</a>
              <a href="/connectors">Connectors</a>
              <a href="/dashboard">Dashboard</a>
            </div>
            <div className="public-footer-col">
              <h4>Legal</h4>
              <a href="/terms">Terms & Conditions</a>
              <a href="/privacy">Privacy Policy</a>
              <a href="/refund">Refund Policy</a>
            </div>
            <div className="public-footer-col">
              <h4>Support</h4>
              <a href="/contact">Contact Us</a>
              <a href="mailto:hello@agenticfactor.io">hello@agenticfactor.io</a>
            </div>
          </div>
        </div>
        <div className="public-footer-bottom">
          <p>© {new Date().getFullYear()} Agentic Factor. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
