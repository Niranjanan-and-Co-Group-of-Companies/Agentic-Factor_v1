import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Agentic Factor — SaaS Multi-Agent Platform",
  description: "Generate specialized multi-agent teams from natural language with enterprise-grade safety and tenant isolation.",
};

import { AuthPopupProvider } from "@/components/providers/AuthProvider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <AuthPopupProvider>
          {children}
        </AuthPopupProvider>
      </body>
    </html>
  );
}
