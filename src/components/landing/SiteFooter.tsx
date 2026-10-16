import Logo from "@/components/brand/Logo";
import ThemeToggle from "./ThemeToggle";
import s from "./landing.module.css";

export default function SiteFooter() {
  return (
    <footer className={s.footer}>
      <div className={s.container}>
        <div className={s.footerGrid}>
          <div>
            <Logo size={28} />
            <p className={s.footerTag}>The AI operations team for lean businesses. Describe the work — agents do the rest, with your approval on every change.</p>
          </div>
          <div className={s.footerCol}>
            <h4>Product</h4>
            <a href="/#how-it-works">How it works</a>
            <a href="/#integrations">Integrations</a>
            <a href="/#pricing">Pricing</a>
            <a href="/dashboard">Command Center</a>
          </div>
          <div className={s.footerCol}>
            <h4>Support</h4>
            <a href="/contact">Contact us</a>
            <a href="mailto:hello@agenticfactor.io">hello@agenticfactor.io</a>
          </div>
          <div className={s.footerCol}>
            <h4>Legal</h4>
            <a href="/terms">Terms &amp; Conditions</a>
            <a href="/privacy">Privacy Policy</a>
            <a href="/refund">Refund Policy</a>
          </div>
        </div>
        <div className={s.footerBottom}>
          <span>© {new Date().getFullYear()} Agentic Factor. All rights reserved.</span>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
