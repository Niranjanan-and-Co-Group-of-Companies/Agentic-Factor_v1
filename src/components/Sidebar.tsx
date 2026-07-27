"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

interface Mission { id: string; title: string; status: string; }
interface UserProfile { name: string; email: string; avatar: string | null; }

const STATUS_COLORS: Record<string, string> = {
  active: "var(--emerald)", building: "var(--amber)", pending_approval: "var(--accent)",
  draft: "var(--purple)", failed: "var(--rose)", deadlocked: "var(--rose)",
};

const NAV_LINKS = [
  { href: "/dashboard",       icon: "📊", label: "Dashboard" },
  { href: "/connectors",      icon: "🔌", label: "Connectors" },
  { href: "/permissions",     icon: "🔑", label: "Credentials" },
  { href: "/dashboard/usage", icon: "📈", label: "Usage & Credits" },
  { href: "/settings/team",   icon: "👥", label: "Team" },
  { href: "/templates",       icon: "📋", label: "Templates" },
  { href: "/audit-logs",      icon: "📜", label: "Audit Logs" },
];

const BOTTOM_LINKS = [
  { href: "/pricing",    icon: "🏷️", label: "Pricing" },
  { href: "/onboarding", icon: "🚀", label: "Get Started" },
  { href: "/contact",    icon: "💬", label: "Support" },
];

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function Sidebar() {
  const [user, setUser]                   = useState<UserProfile | null>(null);
  const [missions, setMissions]           = useState<Mission[]>([]);
  const [loadingAuth, setLoadingAuth]     = useState(true);
  const [loadingMissions, setLoadingMissions] = useState(false);
  const [mobileOpen, setMobileOpen]       = useState(false);
  const pathname = usePathname();

  // Close drawer on every navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  useEffect(() => {
    const supabase = getSupabase();
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (u) {
        setUser({
          name:   u.user_metadata?.full_name || u.user_metadata?.name || u.email?.split("@")[0] || "User",
          email:  u.email || "",
          avatar: u.user_metadata?.avatar_url || u.user_metadata?.picture || null,
        });
        fetchMissions(u.id);

        realtimeChannel = supabase
          .channel("sidebar-missions")
          .on("postgres_changes", { event: "*", schema: "public", table: "missions", filter: `tenant_id=eq.${u.id}` },
            () => fetchMissions(u.id))
          .subscribe();
      }
      setLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          name:   session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split("@")[0] || "User",
          email:  session.user.email || "",
          avatar: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null,
        });
        fetchMissions(session.user.id);
      } else {
        setUser(null);
        setMissions([]);
      }
    });

    return () => {
      subscription.unsubscribe();
      if (realtimeChannel) supabase.removeChannel(realtimeChannel);
    };
  }, []);

  const fetchMissions = async (userId: string) => {
    setLoadingMissions(true);
    try {
      const { data, error } = await getSupabase()
        .from("missions")
        .select("id, title, status")
        .eq("tenant_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!error && data) setMissions(data);
    } catch { /* silent */ }
    setLoadingMissions(false);
  };

  const handleSignOut = async () => {
    await getSupabase().auth.signOut();
    setUser(null);
    setMissions([]);
    window.location.href = "/";
  };

  // ── Shared pieces ────────────────────────────────────────────

  const MissionSkeleton = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 var(--space-sm)" }}>
      {[1, 2, 3].map(i => (
        <div key={i} className="mission-link" style={{ opacity: 0.3 }}>
          <div className="ml-dot animate-glow" style={{ background: "var(--text-muted)" }} />
          <div className="animate-glow" style={{ height: 11, width: `${55 + i * 15}%`, borderRadius: 4, background: "var(--border)" }} />
        </div>
      ))}
    </div>
  );

  const NavLinks = () => (
    <>
      {NAV_LINKS.map(l => (
        <Link key={l.href} href={l.href} className="nav-link">
          <span className="icon">{l.icon}</span>{l.label}
        </Link>
      ))}

      <div className="sidebar-divider" />

      {BOTTOM_LINKS.map(l => (
        <Link key={l.href} href={l.href} className="nav-link">
          <span className="icon">{l.icon}</span>{l.label}
        </Link>
      ))}

      {/* My Missions */}
      <div className="missions-folder">
        <div className="missions-folder-title">📁 My Missions</div>
        {loadingAuth ? <MissionSkeleton /> : user ? (
          loadingMissions ? <MissionSkeleton /> :
          missions.length > 0 ? missions.map(m => (
            <Link key={m.id} href={`/dashboard?mission=${m.id}`} className="mission-link"
              style={m.status === "failed" ? { color: "var(--text-muted)", fontStyle: "italic" } : undefined}>
              <div className="ml-dot" style={{ background: STATUS_COLORS[m.status] || "var(--text-muted)" }} />
              {m.title}{m.status === "failed" ? " (failed)" : ""}
            </Link>
          )) : (
            <Link href="/dashboard/creator" className="mission-link" style={{ color: "var(--emerald)" }}>
              <span style={{ fontSize: "0.9rem" }}>✨</span> Create Your First Mission
            </Link>
          )
        ) : (
          <Link href="/login" className="mission-link" style={{ color: "var(--accent)" }}>
            <span style={{ fontSize: "0.9rem" }}>🔒</span> Sign in to see your missions
          </Link>
        )}
      </div>
    </>
  );

  const UserFooter = () => (
    <div className="sidebar-footer">
      {loadingAuth ? (
        <div className="nav-link" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          <span className="icon animate-glow" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--text-muted)" }} />
          Loading...
        </div>
      ) : user ? (
        <div className="user-profile-card">
          <div className="user-profile-row">
            {user.avatar
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={user.avatar} alt={user.name} className="user-avatar" />
              : <div className="user-avatar user-avatar-fallback">{user.name.charAt(0).toUpperCase()}</div>
            }
            <div className="user-info">
              <div className="user-name">{user.name}</div>
              <div className="user-email">{user.email}</div>
            </div>
          </div>
          <button className="btn-sign-out" onClick={handleSignOut} title="Sign out">↪</button>
        </div>
      ) : (
        <Link href="/login" className="nav-link" style={{ color: "var(--accent)" }}>
          <span className="icon">👤</span> Login / Sign Up
        </Link>
      )}
      <div className="sidebar-status">
        <span className="status-dot active" style={{ display: "inline-block", marginRight: 6 }} />
        System Online &nbsp;·&nbsp; v7.1
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────

  return (
    <>
      {/* Mobile top bar — hidden on desktop via CSS */}
      <div className="mobile-topbar">
        <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect y="3"  width="20" height="2" rx="1" fill="currentColor"/>
            <rect y="9"  width="20" height="2" rx="1" fill="currentColor"/>
            <rect y="15" width="20" height="2" rx="1" fill="currentColor"/>
          </svg>
        </button>
        <Image src="/logo.png" alt="Agentic Factor" width={90} height={49} style={{ objectFit: "contain" }} />
        <div style={{ width: 44 }} />
      </div>

      {/* Desktop sidebar */}
      <nav className="sidebar">
        <div className="sidebar-header">
          <Image src="/logo.png" alt="Agentic Factor" width={160} height={87} style={{ objectFit: "contain" }} />
        </div>
        <div className="sidebar-nav">
          <NavLinks />
        </div>
        <UserFooter />
      </nav>

      {/* Mobile slide-in drawer */}
      {mobileOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setMobileOpen(false)}>
          <nav className="mobile-drawer" onClick={e => e.stopPropagation()}>
            <div className="mobile-drawer-head">
              <Image src="/logo.png" alt="Agentic Factor" width={110} height={60} style={{ objectFit: "contain" }} />
              <button className="mobile-close-btn" onClick={() => setMobileOpen(false)} aria-label="Close menu">✕</button>
            </div>
            <div className="sidebar-nav">
              <NavLinks />
            </div>
            <UserFooter />
          </nav>
        </div>
      )}
    </>
  );
}
