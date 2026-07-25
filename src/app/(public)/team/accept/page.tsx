"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface InviteDetails {
  inviteId: string;
  ownerName: string;
  memberEmail: string;
  role: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin — run missions, edit blueprints, manage team",
  editor: "Editor — run missions and edit blueprints",
  viewer: "Viewer — read-only access to missions and history",
};

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const fetchInvite = useCallback(async () => {
    if (!token) { setError("No invite token provided."); setLoading(false); return; }
    const res = await fetch(`/api/team/accept?token=${token}`);
    if (res.ok) {
      setInvite(await res.json() as InviteDetails);
    } else {
      const { error: err } = await res.json() as { error: string };
      setError(err || "Invite not found or expired.");
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchInvite(); }, [fetchInvite]);

  const acceptInvite = async () => {
    setAccepting(true);
    const res = await fetch("/api/team/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (res.ok) {
      setAccepted(true);
    } else {
      const data = await res.json() as { error: string };
      if (res.status === 401) {
        // Not logged in — redirect to login with return URL
        window.location.href = `/login?next=${encodeURIComponent(window.location.href)}`;
        return;
      }
      setError(data.error || "Failed to accept invite.");
    }
    setAccepting(false);
  };

  const containerStyle: React.CSSProperties = {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "var(--background)", fontFamily: "var(--font-sans, sans-serif)",
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 16, padding: "48px 40px", maxWidth: 460, width: "100%",
    textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: "2rem", marginBottom: 16 }}>⏳</div>
          <div style={{ color: "var(--text-muted)" }}>Loading invite...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: "2.5rem", marginBottom: 16 }}>❌</div>
          <div style={{ fontWeight: 700, fontSize: "1.2rem", marginBottom: 8 }}>Invite Invalid</div>
          <div style={{ color: "var(--text-muted)", marginBottom: 24 }}>{error}</div>
          <a href="/dashboard" className="btn btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: "2.5rem", marginBottom: 16 }}>🎉</div>
          <div style={{ fontWeight: 700, fontSize: "1.2rem", marginBottom: 8 }}>You're in!</div>
          <div style={{ color: "var(--text-muted)", marginBottom: 24 }}>
            You've joined <strong>{invite?.ownerName}</strong>'s team as a <strong>{invite?.role}</strong>.
          </div>
          <a href="/dashboard" className="btn btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
            Go to Dashboard →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: "2.5rem", marginBottom: 20 }}>🤖</div>
        <div style={{ fontWeight: 700, fontSize: "1.25rem", marginBottom: 8 }}>Team Invite</div>
        <div style={{ color: "var(--text-muted)", marginBottom: 24, lineHeight: 1.6 }}>
          <strong>{invite?.ownerName}</strong> has invited{" "}
          <strong>{invite?.memberEmail}</strong> to join their AgenticFactor team.
        </div>

        <div style={{ background: "var(--background)", borderRadius: 10, padding: "14px 18px",
          marginBottom: 28, textAlign: "left", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Your role
          </div>
          <div style={{ fontWeight: 600, textTransform: "capitalize", color: "var(--accent)" }}>
            {invite?.role}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
            {ROLE_LABELS[invite?.role ?? "viewer"]}
          </div>
        </div>

        <button className="btn btn-primary" onClick={acceptInvite} disabled={accepting}
          style={{ width: "100%", padding: "14px", fontSize: "1rem", borderRadius: 10 }}>
          {accepting ? "Accepting..." : "Accept Invite"}
        </button>
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 14 }}>
          You'll need to be signed in to accept. Not signed in?{" "}
          <a href={`/login?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
            style={{ color: "var(--accent)" }}>Log in first</a>
        </div>
      </div>
    </div>
  );
}

export default function TeamAcceptPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div>Loading...</div>
      </div>
    }>
      <AcceptInviteContent />
    </Suspense>
  );
}
