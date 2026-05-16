"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createBrowserClient } from "@supabase/ssr";

// ============================================================
// Sidebar — Live Data + Auth-Gated + Real Profile
// ============================================================

interface Mission { id: string; title: string; status: string; }
interface UserProfile { name: string; email: string; avatar: string | null; }

const STATUS_COLORS: Record<string, string> = {
  active: "var(--emerald)", building: "var(--amber)", pending_approval: "var(--accent)",
  draft: "var(--purple)", failed: "var(--rose)", deadlocked: "var(--rose)",
};

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function Sidebar() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingMissions, setLoadingMissions] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

    // Check current user
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (u) {
        const profile: UserProfile = {
          name: u.user_metadata?.full_name || u.user_metadata?.name || u.email?.split("@")[0] || "User",
          email: u.email || "",
          avatar: u.user_metadata?.avatar_url || u.user_metadata?.picture || null,
        };
        setUser(profile);
        fetchMissions(u.id);

        // ── Realtime subscription: missions table ──
        realtimeChannel = supabase
          .channel('sidebar-missions')
          .on('postgres_changes', {
            event: '*', // INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'missions',
            filter: `tenant_id=eq.${u.id}`,
          }, () => {
            // Re-fetch on any change
            fetchMissions(u.id);
          })
          .subscribe();
      }
      setLoadingAuth(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const profile: UserProfile = {
          name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split("@")[0] || "User",
          email: session.user.email || "",
          avatar: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null,
        };
        setUser(profile);
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
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("missions")
        .select("id, title, status")
        .eq("tenant_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (!error && data) setMissions(data);
    } catch {
      // Table might not exist yet — silent fail
    }
    setLoadingMissions(false);
  };

  const handleSignOut = async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    setUser(null);
    setMissions([]);
    window.location.href = "/";
  };

  // ── Skeleton loader for missions ──
  const MissionSkeleton = () => (
    <div className="stack" style={{ gap: "6px", padding: "0 var(--space-sm)" }}>
      {[1, 2, 3].map(i => (
        <div key={i} className="mission-link" style={{ opacity: 0.3 }}>
          <div className="ml-dot animate-glow" style={{ background: "var(--text-muted)" }} />
          <div className="animate-glow" style={{ height: 12, width: `${60 + i * 15}%`, borderRadius: 4, background: "var(--border)" }} />
        </div>
      ))}
    </div>
  );

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <Image src="/logo.png" alt="Agentic Factor" width={32} height={32} style={{ borderRadius: 6 }} />
        <span>Agentic Factor</span>
      </div>
      <Link href="/dashboard" className="nav-link">
        <span className="icon">📊</span> Dashboard
      </Link>

      <Link href="/connectors" className="nav-link">
        <span className="icon">🔌</span> Connectors
      </Link>

      <Link href="/permissions" className="nav-link">
        <span className="icon">🔑</span> Credentials
      </Link>

      <div style={{ borderTop: "1px solid var(--border)", margin: "var(--space-sm) 0" }} />

      <Link href="/pricing" className="nav-link">
        <span className="icon">🏷️</span> Pricing
      </Link>
      <Link href="/terms" className="nav-link">
        <span className="icon">📜</span> Terms & Conditions
      </Link>
      <Link href="/contact" className="nav-link">
        <span className="icon">💬</span> Support
      </Link>

      {/* ═══ MY MISSIONS — LIVE DATA ═══ */}
      <div className="missions-folder">
        <div className="missions-folder-title">📁 My Missions</div>
        {loadingAuth ? (
          <MissionSkeleton />
        ) : user ? (
          loadingMissions ? (
            <MissionSkeleton />
          ) : missions.length > 0 ? (
            missions.map((m) => (
              <Link key={m.id} href={`/dashboard?mission=${m.id}`} className="mission-link"
                style={m.status === "failed" ? { color: "var(--text-muted)", fontStyle: "italic" } : undefined}>
                <div className="ml-dot" style={{ background: STATUS_COLORS[m.status] || "var(--text-muted)" }} />
                {m.title}{m.status === "failed" ? " (failed)" : ""}
              </Link>
            ))
          ) : (
            <Link href="/dashboard/creator" className="mission-link" style={{ color: "var(--emerald)", gap: "8px" }}>
              <span style={{ fontSize: "0.9rem" }}>✨</span>
              Create Your First Mission
            </Link>
          )
        ) : (
          <Link href="/login" className="mission-link" style={{ color: "var(--accent)", gap: "8px" }}>
            <span style={{ fontSize: "0.9rem" }}>🔒</span>
            Sign in to see your missions
          </Link>
        )}
      </div>

      {/* ═══ USER PROFILE ═══ */}
      {loadingAuth ? (
        <div className="nav-link" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          <span className="icon animate-glow" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--text-muted)" }} />
          Loading...
        </div>
      ) : user ? (
        <div className="user-profile-card">
          <div className="user-profile-row">
            {user.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar} alt={user.name} className="user-avatar" />
            ) : (
              <div className="user-avatar user-avatar-fallback">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
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

      <div style={{ padding: "var(--space-md)", borderTop: "1px solid var(--border)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
          <span className="status-dot active" />
          System Online
        </div>
        v7.1 — Live Data
      </div>
    </nav>
  );
}
