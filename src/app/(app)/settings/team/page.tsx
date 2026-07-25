"use client";
import { useState, useEffect, useCallback } from "react";

interface TeamMember {
  id: string;
  member_email: string;
  member_user_id: string | null;
  role: "admin" | "editor" | "viewer";
  status: "pending" | "accepted" | "revoked";
  invited_at: string;
  accepted_at: string | null;
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin:  "Run missions, edit blueprints, manage team members",
  editor: "Run missions, edit blueprints",
  viewer: "View missions and run history — read only",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "var(--rose)", editor: "var(--amber)", viewer: "var(--emerald)",
};

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    const res = await fetch("/api/team");
    if (res.ok) {
      const { members: m } = await res.json() as { members: TeamMember[] };
      setMembers(m ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    if (res.ok) {
      setInviteSuccess(true);
      setInviteEmail("");
      setTimeout(() => setInviteSuccess(false), 3000);
      await fetchMembers();
    } else {
      const { error } = await res.json() as { error: string };
      setInviteError(error || "Failed to send invite");
    }
    setInviting(false);
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

  const revokeMember = async (memberId: string) => {
    if (!confirm("Remove this team member? They will lose access immediately.")) return;
    setRevoking(memberId);
    await fetch(`/api/team?memberId=${memberId}`, { method: "DELETE" });
    setRevoking(null);
    await fetchMembers();
  };

  const card: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: "var(--radius)", padding: "var(--space-lg)",
  };

  return (
    <div className="page-container stack" style={{ gap: "var(--space-lg)", maxWidth: 760 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: "1.5rem" }}>Team Management</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: 4 }}>
          Invite colleagues to view or operate your missions. Each role controls what they can do.
        </div>
      </div>

      {/* Role reference */}
      <div style={{ ...card, background: "color-mix(in srgb, var(--accent) 8%, transparent)" }}>
        <div style={{ fontWeight: 600, marginBottom: "var(--space-sm)", fontSize: "0.9rem" }}>Role Permissions</div>
        <div style={{ display: "flex", gap: "var(--space-lg)", flexWrap: "wrap" }}>
          {Object.entries(ROLE_DESCRIPTIONS).map(([role, desc]) => (
            <div key={role} style={{ fontSize: "0.82rem" }}>
              <span style={{ fontWeight: 600, color: ROLE_COLORS[role], textTransform: "capitalize" }}>{role}</span>
              <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Invite form */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: "var(--space-md)" }}>Invite a Team Member</div>
        <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
          <input
            type="email"
            placeholder="colleague@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendInvite()}
            style={{ flex: 1, minWidth: 200, padding: "var(--space-sm) var(--space-md)",
              background: "var(--background)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", color: "var(--text)", fontSize: "0.9rem" }}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
            style={{ padding: "var(--space-sm) var(--space-md)", background: "var(--background)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              color: "var(--text)", fontSize: "0.9rem" }}>
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary" onClick={sendInvite}
            disabled={inviting || !inviteEmail.trim()}>
            {inviting ? "Sending..." : inviteSuccess ? "✓ Invite sent!" : "Send Invite"}
          </button>
        </div>
        {inviteError && (
          <div style={{ marginTop: "var(--space-sm)", color: "var(--rose)", fontSize: "0.85rem" }}>
            {inviteError}
          </div>
        )}
      </div>

      {/* Member list */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: "var(--space-md)" }}>
          Team Members {members.length > 0 && `(${members.length})`}
        </div>

        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading...</div>
        ) : members.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--space-xl)", color: "var(--text-muted)" }}>
            <div style={{ fontSize: "2rem", marginBottom: "var(--space-sm)" }}>👥</div>
            No team members yet. Invite someone above.
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
                  fontWeight: 700, fontSize: "0.9rem", flexShrink: 0 }}>
                  {m.member_email[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.member_email}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {m.status === "accepted"
                      ? `Joined ${new Date(m.accepted_at!).toLocaleDateString()}`
                      : `Invited ${new Date(m.invited_at).toLocaleDateString()} · awaiting acceptance`}
                  </div>
                </div>

                {/* Status badge */}
                <span style={{ fontSize: "0.72rem", borderRadius: 4, padding: "2px 7px", fontWeight: 600,
                  background: m.status === "accepted"
                    ? "color-mix(in srgb, var(--emerald) 15%, transparent)"
                    : "color-mix(in srgb, var(--amber) 15%, transparent)",
                  color: m.status === "accepted" ? "var(--emerald)" : "var(--amber)" }}>
                  {m.status === "accepted" ? "Active" : "Pending"}
                </span>

                {/* Role selector */}
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m.id, e.target.value)}
                  disabled={changingRole === m.id}
                  style={{ padding: "4px 8px", background: "var(--surface)", fontSize: "0.8rem",
                    border: "1px solid var(--border)", borderRadius: 4, color: ROLE_COLORS[m.role] }}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>

                <button
                  onClick={() => revokeMember(m.id)}
                  disabled={revoking === m.id}
                  style={{ background: "none", border: "1px solid var(--border)", borderRadius: 4,
                    color: "var(--rose)", cursor: "pointer", padding: "4px 10px", fontSize: "0.8rem",
                    opacity: revoking === m.id ? 0.5 : 1 }}>
                  {revoking === m.id ? "..." : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
