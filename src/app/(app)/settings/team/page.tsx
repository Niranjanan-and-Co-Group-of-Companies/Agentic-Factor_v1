"use client";
import { useState, useEffect, useCallback } from "react";

interface TeamMember {
  id: string;
  member_email: string;
  member_user_id: string | null;
  role: "admin" | "collaborator" | "editor" | "viewer";
  status: "pending" | "accepted" | "revoked";
  invited_at: string;
  accepted_at: string | null;
}

interface SeatInfo {
  used: number;
  limit: number;
  plan: string;
}

const WORKSPACE_ROLE_LABELS: Record<string, string> = {
  admin:        "Run missions, edit blueprints, manage team members",
  collaborator: "Chat with AI, run missions — cannot edit blueprints or invite",
  viewer:       "View missions and run history — read only",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "#ef4444", collaborator: "#6366f1", editor: "#f59e0b", viewer: "#10b981",
};

const PLAN_SEAT_LIMITS: Record<string, number> = {
  free: 0, individual: 0, pro: 25, enterprise: 999999,
};

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [seatInfo, setSeatInfo] = useState<SeatInfo>({ used: 0, limit: 0, plan: "free" });
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "collaborator" | "viewer">("collaborator");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    const [membersRes, billingRes, seatRes] = await Promise.all([
      fetch("/api/team"),
      fetch("/api/billing/status"),
      fetch("/api/team/seats"),
    ]);
    if (membersRes.ok) {
      const { members: m } = await membersRes.json() as { members: TeamMember[] };
      setMembers(m ?? []);
    }
    let plan = "free";
    if (billingRes.ok) {
      const b = await billingRes.json() as { plan?: string };
      plan = b.plan ?? "free";
    }
    let used = 0;
    if (seatRes.ok) {
      const s = await seatRes.json() as { count?: number };
      used = s.count ?? 0;
    }
    const limit = PLAN_SEAT_LIMITS[plan] ?? 0;
    setSeatInfo({ used, limit, plan });
    setLoading(false);
  }, []);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteResult(null);
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    if (res.ok) {
      setInviteResult({ type: "success", message: `Invite sent to ${inviteEmail.trim()}` });
      setInviteEmail("");
      await fetchMembers();
    } else {
      const { error } = await res.json() as { error: string };
      setInviteResult({ type: "error", message: error || "Failed to send invite" });
    }
    setInviting(false);
    setTimeout(() => setInviteResult(null), 5000);
  };

  const changeRole = async (memberId: string, role: string) => {
    setChangingRole(memberId);
    await fetch("/api/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, role }),
    });
    setChangingRole(null);
    await fetchMembers();
  };

  const revokeMember = async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email}? They will lose all workspace access immediately.`)) return;
    setRevoking(memberId);
    await fetch(`/api/team?memberId=${memberId}`, { method: "DELETE" });
    setRevoking(null);
    await fetchMembers();
  };

  const card: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: "var(--radius)", padding: "var(--space-lg)",
  };

  const seatsExhausted = seatInfo.limit > 0 && seatInfo.used >= seatInfo.limit;
  const noInvitesOnPlan = seatInfo.limit === 0;

  return (
    <div className="page-container stack" style={{ gap: "var(--space-lg)", maxWidth: 780 }}>
      {/* ── Header ── */}
      <div>
        <div style={{ fontWeight: 700, fontSize: "1.5rem" }}>Team & Collaboration</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: 4 }}>
          Invite colleagues to your workspace or to individual missions.
        </div>
      </div>

      {/* ── Seat usage bar ── */}
      {!loading && (
        <div style={{ ...card, background: seatsExhausted ? "color-mix(in srgb, #ef4444 6%, transparent)" : "color-mix(in srgb, var(--accent) 6%, transparent)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
              {noInvitesOnPlan
                ? `Team invites — not available on ${seatInfo.plan} plan`
                : seatInfo.limit >= 999999
                ? "Team seats — Enterprise (unlimited)"
                : `Team seats — ${seatInfo.used} / ${seatInfo.limit} used`}
            </div>
            {noInvitesOnPlan && (
              <a href="/pricing" className="btn btn-primary btn-sm" style={{ fontSize: "0.78rem", textDecoration: "none" }}>
                Upgrade to Pro →
              </a>
            )}
            {seatsExhausted && !noInvitesOnPlan && (
              <a href="/pricing" className="btn btn-primary btn-sm" style={{ fontSize: "0.78rem", textDecoration: "none" }}>
                Upgrade to Enterprise →
              </a>
            )}
          </div>
          {!noInvitesOnPlan && seatInfo.limit < 999999 && (
            <div style={{ height: 6, background: "var(--border)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 6,
                background: seatsExhausted ? "#ef4444" : "var(--accent)",
                width: `${Math.min(100, Math.round((seatInfo.used / seatInfo.limit) * 100))}%`,
                transition: "width 0.4s ease",
              }} />
            </div>
          )}
          {!noInvitesOnPlan && (
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 8 }}>
              Counts unique emails across workspace and mission-level invites. Remove revoked members to free seats.
            </div>
          )}
        </div>
      )}

      {/* ── Role reference ── */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: "var(--space-sm)", fontSize: "0.9rem" }}>Workspace Roles</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(WORKSPACE_ROLE_LABELS).map(([role, desc]) => (
            <div key={role} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: "0.83rem" }}>
              <span style={{ fontWeight: 600, color: ROLE_COLORS[role], textTransform: "capitalize", minWidth: 90, flexShrink: 0 }}>{role}</span>
              <span style={{ color: "var(--text-muted)" }}>{desc}</span>
            </div>
          ))}
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 10, fontSize: "0.78rem", color: "var(--text-muted)" }}>
            For single-mission access (contractors, clients) use the <strong>Share</strong> button inside each mission's chat.
          </div>
        </div>
      </div>

      {/* ── Invite form ── */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: "var(--space-md)" }}>
          Invite to Workspace
          <span style={{ fontWeight: 400, fontSize: "0.8rem", color: "var(--text-muted)", marginLeft: 8 }}>
            — they'll see all missions
          </span>
        </div>

        {noInvitesOnPlan ? (
          <div style={{ color: "var(--text-muted)", fontSize: "0.87rem", padding: "10px 0" }}>
            Team invites are available on Pro (up to 25 members) and Enterprise (unlimited). <a href="/pricing" style={{ color: "var(--accent)" }}>View plans →</a>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
              <input
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendInvite()}
                disabled={seatsExhausted}
                style={{ flex: 1, minWidth: 200, padding: "var(--space-sm) var(--space-md)",
                  background: "var(--background)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)", color: "var(--text)", fontSize: "0.9rem",
                  opacity: seatsExhausted ? 0.5 : 1 }}
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
                disabled={seatsExhausted}
                style={{ padding: "var(--space-sm) var(--space-md)", background: "var(--background)",
                  border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                  color: "var(--text)", fontSize: "0.9rem", opacity: seatsExhausted ? 0.5 : 1 }}>
                <option value="viewer">Viewer</option>
                <option value="collaborator">Collaborator</option>
                <option value="admin">Admin</option>
              </select>
              <button className="btn btn-primary" onClick={sendInvite}
                disabled={inviting || !inviteEmail.trim() || seatsExhausted}>
                {inviting ? "Sending…" : "Send Invite"}
              </button>
            </div>
            {inviteResult && (
              <div style={{ marginTop: "var(--space-sm)", fontSize: "0.85rem",
                color: inviteResult.type === "success" ? "var(--emerald)" : "#ef4444" }}>
                {inviteResult.type === "success" ? "✓ " : "✗ "}{inviteResult.message}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Member list ── */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: "var(--space-md)", display: "flex", alignItems: "center", gap: 8 }}>
          Workspace Members
          {members.length > 0 && (
            <span style={{ fontSize: "0.75rem", background: "var(--background)", border: "1px solid var(--border)", borderRadius: 12, padding: "1px 8px", color: "var(--text-muted)" }}>
              {members.length}
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading…</div>
        ) : members.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--space-xl)", color: "var(--text-muted)" }}>
            <div style={{ fontSize: "2rem", marginBottom: "var(--space-sm)" }}>👥</div>
            No workspace members yet.{" "}
            {noInvitesOnPlan ? "Upgrade to Pro to invite your team." : "Invite someone above."}
          </div>
        ) : (
          <div className="stack" style={{ gap: "var(--space-sm)" }}>
            {members.map((m) => (
              <div key={m.id} style={{
                display: "flex", alignItems: "center", gap: "var(--space-md)",
                padding: "var(--space-sm) var(--space-md)",
                background: "var(--background)", borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
              }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%",
                  background: "color-mix(in srgb, var(--accent) 20%, transparent)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: "0.9rem", flexShrink: 0, color: "var(--accent)" }}>
                  {m.member_email[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.88rem" }}>
                    {m.member_email}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                    {m.status === "accepted"
                      ? `Joined ${new Date(m.accepted_at!).toLocaleDateString("en-IN")}`
                      : `Invited ${new Date(m.invited_at).toLocaleDateString("en-IN")} · awaiting acceptance`}
                  </div>
                </div>

                <span style={{ fontSize: "0.7rem", borderRadius: 4, padding: "2px 7px", fontWeight: 600,
                  background: m.status === "accepted"
                    ? "color-mix(in srgb, #10b981 15%, transparent)"
                    : "color-mix(in srgb, #f59e0b 15%, transparent)",
                  color: m.status === "accepted" ? "#10b981" : "#f59e0b" }}>
                  {m.status === "accepted" ? "Active" : "Pending"}
                </span>

                <select
                  value={m.role}
                  onChange={(e) => changeRole(m.id, e.target.value)}
                  disabled={changingRole === m.id}
                  style={{ padding: "4px 8px", background: "var(--surface)", fontSize: "0.79rem",
                    border: "1px solid var(--border)", borderRadius: 4, color: ROLE_COLORS[m.role] ?? "var(--text)" }}>
                  <option value="viewer">Viewer</option>
                  <option value="collaborator">Collaborator</option>
                  <option value="admin">Admin</option>
                </select>

                <button
                  onClick={() => revokeMember(m.id, m.member_email)}
                  disabled={revoking === m.id}
                  style={{ background: "none", border: "1px solid var(--border)", borderRadius: 4,
                    color: "#ef4444", cursor: "pointer", padding: "4px 10px", fontSize: "0.79rem",
                    opacity: revoking === m.id ? 0.5 : 1, flexShrink: 0 }}>
                  {revoking === m.id ? "…" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Mission-level invites info ── */}
      <div style={{ ...card, background: "color-mix(in srgb, var(--accent) 4%, transparent)" }}>
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: "0.9rem" }}>Mission-Level Access (Option A)</div>
        <div style={{ fontSize: "0.83rem", color: "var(--text-muted)", lineHeight: 1.65 }}>
          To give someone access to a <em>single mission only</em> — without seeing the rest of your workspace — open that mission's chat and click the <strong>Share</strong> button in the header. They'll get an email invite and can accept without seeing any of your other missions. Mission-only invites also count toward your {seatInfo.limit >= 999999 ? "unlimited" : `${seatInfo.limit}-seat`} plan limit.
        </div>
      </div>
    </div>
  );
}
