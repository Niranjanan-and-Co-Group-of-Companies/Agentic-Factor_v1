import type { Metadata } from "next";
import SiteNav from "@/components/landing/SiteNav";
import SiteFooter from "@/components/landing/SiteFooter";

export const metadata: Metadata = {
  title: "Agentic Factor — Describe the work. Agents do the rest.",
  description: "Agentic Factor turns a plain-language request into a team of AI agents that works across 1,600+ apps — and asks before it changes anything that matters.",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-layout">
      <SiteNav />
      <main className="public-main">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
