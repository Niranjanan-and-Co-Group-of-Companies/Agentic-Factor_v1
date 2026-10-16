import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Type system: a precise grotesk for the interface, an editorial serif for display headlines,
// a technical mono for small labels and code.
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", display: "swap" });
const display = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Agentic Factor — Describe the work. Agents do the rest.",
  description: "Agentic Factor turns a plain-language request into a team of AI agents that works across your apps — and asks before it changes anything that matters.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F3EC" },
    { media: "(prefers-color-scheme: dark)", color: "#131210" },
  ],
};

import { AuthPopupProvider } from "@/components/providers/AuthProvider";

// Runs before first paint: a saved choice wins, otherwise the system preference — no flash of the wrong theme.
const themeScript = `(function(){try{var t=localStorage.getItem('af-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`} data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AuthPopupProvider>
          {children}
        </AuthPopupProvider>
      </body>
    </html>
  );
}
