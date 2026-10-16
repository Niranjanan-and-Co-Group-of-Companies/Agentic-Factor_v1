"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import Link from "next/link";
import Logo from "@/components/brand/Logo";
import s from "./landing.module.css";

const LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#safety", label: "Safety" },
  { href: "/#integrations", label: "Integrations" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export default function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
      <header className={`${s.nav} ${scrolled || open ? s.navScrolled : ""}`}>
        <div className={`${s.container} ${s.navInner}`}>
          <Link href="/" className={s.navBrand} aria-label="Agentic Factor — home"><Logo size={28} /></Link>
          <nav className={s.navLinks} aria-label="Main">
            {LINKS.map(l => <Link key={l.href} href={l.href} className={s.navLink}>{l.label}</Link>)}
          </nav>
          <div className={s.navActions}>
            <Link href="/login" className={s.navLogin}>Log in</Link>
            <Link href="/dashboard" className={`${s.btn} ${s.btnPrimary} ${s.btnSm}`}>Try it free <ArrowRight size={15} strokeWidth={2} aria-hidden /></Link>
            <button type="button" className={s.menuBtn} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="site-menu" aria-label={open ? "Close menu" : "Open menu"}>
              {open ? <X size={18} strokeWidth={1.75} /> : <Menu size={18} strokeWidth={1.75} />}
            </button>
          </div>
        </div>
      </header>
      <div id="site-menu" className={`${s.sheet} ${open ? s.sheetOpen : ""}`} aria-hidden={!open}>
        {LINKS.map(l => <Link key={l.href} href={l.href} className={s.sheetLink} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>{l.label}</Link>)}
        <div className={s.sheetActions}>
          <Link href="/dashboard" className={`${s.btn} ${s.btnPrimary}`} tabIndex={open ? 0 : -1}>Try it free <ArrowRight size={16} strokeWidth={2} aria-hidden /></Link>
          <Link href="/login" className={`${s.btn} ${s.btnGhost}`} tabIndex={open ? 0 : -1}>Log in</Link>
        </div>
      </div>
    </>
  );
}
