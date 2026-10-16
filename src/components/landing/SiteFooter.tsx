import Link from "next/link";
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
            <Link href="/#how-it-works">How it works</Link>
            <Link href="/#integrations">Integrations</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/dashboard">Command Center</Link>
          </div>
          <div className={s.footerCol}>
            <h4>Support</h4>
            <Link href="/contact">Contact us</Link>
            <a href="mailto:hello@agenticfactor.io">hello@agenticfactor.io</a>
          </div>
          <div className={s.footerCol}>
            <h4>Legal</h4>
            <Link href="/terms">Terms &amp; Conditions</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/refund">Refund Policy</Link>
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
