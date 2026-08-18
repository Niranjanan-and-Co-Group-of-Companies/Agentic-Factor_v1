"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

interface UserProfile { name: string; email: string; avatar: string | null; }

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Core nav — lean and purposeful
const NAV_ITEMS = [
  { href: "/dashboard",       icon: "✦",  label: "Command Center" },
  { href: "/connectors",      icon: "🔌", label: "Connectors"     },
  { href: "/dashboard/usage", icon: "📈", label: "Usage & Credits" },
  { href: "/pricing",         icon: "🏷️", label: "Plans & Pricing" },
  { href: "/permissions",     icon: "🔑", label: "Credentials"    },
  { href: "/audit-logs",      icon: "📜", label: "Audit Logs"     },
];

const BOTTOM_LINKS = [
  { href: "/settings/team", icon: "👥", label: "Team"    },
  { href: "/contact",       icon: "💬", label: "Support" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const [user, setUser]           = useState<UserProfile | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed]  = useState(false);
  const [isDark, setIsDark]        = useState(true);

  // Persist collapse state
  useEffect(() => {
    const saved = localStorage.getItem("af-sidebar-collapsed");
    const col = saved === "true";
    setCollapsed(col);
    document.documentElement.style.setProperty("--sidebar-width", col ? "64px" : "260px");
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("af-sidebar-collapsed", String(next));
      document.documentElement.style.setProperty("--sidebar-width", next ? "64px" : "260px");
      return next;
    });
  }, []);

  // Theme
  useEffect(() => {
    const saved = localStorage.getItem("af-theme");
    setIsDark(saved !== "light");
  }, []);

  const toggleTheme = () => {
    const next = isDark ? "light" : "dark";
    setIsDark(!isDark);
    document.documentElement.setAttribute("data-theme", next === "light" ? "light" : "");
    if (next === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("af-theme", next);
  };

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  // Auth
  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (u) setUser({ name: u.user_metadata?.full_name || u.user_metadata?.name || u.email?.split("@")[0] || "User", email: u.email || "", avatar: u.user_metadata?.avatar_url || u.user_metadata?.picture || null });
      setLoadingAuth(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) setUser({ name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split("@")[0] || "User", email: session.user.email || "", avatar: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null });
      else setUser(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await getSupabase().auth.signOut();
    setUser(null);
    window.location.href = "/";
  };

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  // ── Nav link (works in both collapsed and expanded) ──
  const NavLink = ({ href, icon, label }: { href: string; icon: string; label: string }) => {
    const active = isActive(href);
    return (
      <Link
        href={href}
        title={collapsed ? label : undefined}
        style={{
          display: "flex", alignItems: "center",
          gap: collapsed ? 0 : "10px",
          justifyContent: collapsed ? "center" : "flex-start",
          padding: collapsed ? "10px 0" : "8px 14px",
          borderRadius: "var(--radius-sm)",
          textDecoration: "none",
          fontSize: "0.82rem",
          fontWeight: active ? 600 : 400,
          color: active ? "var(--accent)" : "var(--text-secondary)",
          background: active ? "var(--accent-subtle)" : "transparent",
          transition: "all 0.15s",
          whiteSpace: "nowrap",
          overflow: "hidden",
          minWidth: 0,
          width: "100%",
        }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLAnchorElement).style.background = "var(--bg-card)"; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; }}
      >
        <span style={{ fontSize: "1rem", flexShrink: 0, lineHeight: 1, width: collapsed ? "100%" : "auto", textAlign: collapsed ? "center" : "left" }}>{icon}</span>
        {!collapsed && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>}
      </Link>
    );
  };

  // ── Shared inner content ──
  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Logo + collapse toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed && !mobile ? "center" : "space-between", padding: collapsed && !mobile ? "14px 0" : "14px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {(!collapsed || mobile) && (
          <Link href="/dashboard">
            <Image src="/logo.png" alt="Agentic Factor" width={120} height={32} style={{ objectFit: "contain", display: "block" }} />
          </Link>
        )}
        {collapsed && !mobile && (
          <Link href="/dashboard" title="Command Center">
            <span style={{ fontSize: "1.3rem", lineHeight: 1 }}>✦</span>
          </Link>
        )}
        {!mobile && (
          <button
            onClick={toggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: 1, padding: "4px", borderRadius: "var(--radius-sm)", flexShrink: 0, display: "flex", alignItems: "center" }}
          >
            {collapsed ? "›" : "‹"}
          </button>
        )}
      </div>

      {/* Main nav */}
      <div style={{ flex: 1, overflowY: "auto", padding: collapsed && !mobile ? "8px 4px" : "8px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV_ITEMS.map(item => <NavLink key={item.href} {...item} />)}

        {/* Divider */}
        <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />

        {BOTTOM_LINKS.map(item => <NavLink key={item.href} {...item} />)}

        {/* New Mission CTA */}
        {!collapsed && (
          <button
            onClick={() => router.push("/dashboard?new=1")}
            style={{ marginTop: 8, width: "100%", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", padding: "8px 14px", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8, transition: "opacity 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.88")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >
            <span>+</span> New Mission
          </button>
        )}
        {collapsed && (
          <button
            onClick={() => router.push("/dashboard?new=1")}
            title="New Mission"
            style={{ width: "100%", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", padding: "10px 0", fontSize: "1rem", cursor: "pointer", textAlign: "center", marginTop: 8 }}
          >
            +
          </button>
        )}
      </div>

      {/* Footer: user + theme */}
      <div style={{ borderTop: "1px solid var(--border)", padding: collapsed && !mobile ? "8px 4px" : "8px 10px", flexShrink: 0 }}>
        {/* Theme toggle */}
        <div style={{ display: "flex", justifyContent: collapsed && !mobile ? "center" : "flex-end", marginBottom: 6 }}>
          <button
            onClick={toggleTheme}
            title={isDark ? "Light mode" : "Dark mode"}
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "3px 7px", cursor: "pointer", fontSize: "0.78rem", color: "var(--text-secondary)" }}
          >
            {isDark ? "☀️" : "🌙"}
          </button>
        </div>

        {/* User */}
        {loadingAuth ? null : user ? (
          <div style={{ display: "flex", alignItems: "center", gap: collapsed && !mobile ? 0 : 8, justifyContent: collapsed && !mobile ? "center" : "flex-start" }}>
            {user.avatar
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={user.avatar} alt={user.name} style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, objectFit: "cover" }} />
              : <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.82rem", fontWeight: 700, flexShrink: 0 }}>{user.name.charAt(0).toUpperCase()}</div>
            }
            {(!collapsed || mobile) && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</div>
                <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
              </div>
            )}
            {(!collapsed || mobile) && (
              <button onClick={handleSignOut} title="Sign out" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "0.85rem", padding: "2px 4px", flexShrink: 0 }}>↪</button>
            )}
          </div>
        ) : (
          <Link href="/login" style={{ display: "flex", alignItems: "center", justifyContent: collapsed && !mobile ? "center" : "flex-start", gap: 8, textDecoration: "none", color: "var(--accent)", fontSize: "0.8rem" }}>
            <span>👤</span>{(!collapsed || mobile) && "Sign in"}
          </Link>
        )}

        {/* System status */}
        {!collapsed && (
          <div style={{ marginTop: 8, fontSize: "0.65rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, paddingLeft: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--emerald)", display: "inline-block" }} />
            System Online · v8.0
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="mobile-topbar">
        <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect y="3"  width="20" height="2" rx="1" fill="currentColor"/>
            <rect y="9"  width="20" height="2" rx="1" fill="currentColor"/>
            <rect y="15" width="20" height="2" rx="1" fill="currentColor"/>
          </svg>
        </button>
        <Image src="/logo.png" alt="Agentic Factor" width={90} height={32} style={{ objectFit: "contain" }} />
        <button onClick={() => router.push("/dashboard?new=1")} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", padding: "6px 12px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>+ New</button>
      </div>

      {/* Desktop sidebar */}
      <nav
        className="sidebar"
        style={{ width: collapsed ? 64 : 260, transition: "width 0.2s ease" }}
      >
        <SidebarContent />
      </nav>

      {/* Mobile slide-in drawer */}
      {mobileOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setMobileOpen(false)}>
          <nav className="mobile-drawer" onClick={e => e.stopPropagation()}>
            <div className="mobile-drawer-head">
              <Image src="/logo.png" alt="Agentic Factor" width={110} height={30} style={{ objectFit: "contain" }} />
              <button className="mobile-close-btn" onClick={() => setMobileOpen(false)} aria-label="Close menu">✕</button>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              <SidebarContent mobile />
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
