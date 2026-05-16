"use client";
import { useState, useEffect } from "react";

// ============================================================
// Admin Dashboard — Overview, Connectors, Tenants, Missions
// With Add/Remove Admin Users popup.
// ============================================================

type Tab = "dashboard" | "connectors" | "tenants" | "missions";

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");

  // Admin user management
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [adminList, setAdminList] = useState<any[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [adminActionLoading, setAdminActionLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { checkAuth(); }, []);
  useEffect(() => { if (authenticated) fetchData(); }, [authenticated, tab]);

  const checkAuth = async () => {
    const res = await fetch("/api/mgmt-x7k9/auth");
    if (res.ok) {
      const d = await res.json();
      setAuthenticated(true);
      setAdminEmail(d.email);
    } else {
      window.location.href = "/mgmt-x7k9/login";
    }
  };

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch(`/api/mgmt-x7k9/data?view=${tab}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  };

  const fetchAdmins = async () => {
    const res = await fetch("/api/mgmt-x7k9/users");
    if (res.ok) {
      const d = await res.json();
      setAdminList(d.admins || []);
    }
  };

  const handleAddAdmin = async () => {
    if (!newAdminEmail || !newAdminPassword || newAdminPassword.length < 8) return;
    setAdminActionLoading(true);
    const res = await fetch("/api/mgmt-x7k9/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newAdminEmail, password: newAdminPassword }),
    });
    const d = await res.json();
    setAdminActionLoading(false);
    if (res.ok) {
      setToast(`✅ ${newAdminEmail} added as admin`);
      setNewAdminEmail(""); setNewAdminPassword("");
      fetchAdmins();
    } else {
      setToast(`❌ ${d.error}`);
    }
    setTimeout(() => setToast(null), 4000);
  };

  const handleRemoveAdmin = async (adminId: string) => {
    if (!confirm("Remove this admin?")) return;
    const res = await fetch("/api/mgmt-x7k9/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminId }),
    });
    if (res.ok) {
      setToast("Admin removed");
      fetchAdmins();
    } else {
      const d = await res.json();
      setToast(`❌ ${d.error}`);
    }
    setTimeout(() => setToast(null), 4000);
  };

  const handleMarkConfigured = async (eventId: string, connectorId: string) => {
    await fetch("/api/mgmt-x7k9/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_connector_configured", eventId, connectorId }),
    });
    setToast("✅ Connector marked as configured. User notified.");
    fetchData();
    setTimeout(() => setToast(null), 4000);
  };

  const handleLogout = async () => {
    await fetch("/api/mgmt-x7k9/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    window.location.href = "/mgmt-x7k9/login";
  };

  if (!authenticated) return null;

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "dashboard", label: "Overview", icon: "📊" },
    { key: "connectors", label: "Connectors", icon: "🔌" },
    { key: "tenants", label: "Tenants", icon: "👥" },
    { key: "missions", label: "Missions", icon: "🎯" },
  ];

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 className="page-title">🛡️ Admin Panel</h1>
            <p className="page-subtitle">Logged in as {adminEmail}</p>
          </div>
          <div className="row" style={{ gap: "var(--space-sm)" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowAddAdmin(true); fetchAdmins(); }}>👤 Manage Admins</button>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="row" style={{ gap: "var(--space-sm)", marginBottom: "var(--space-xl)" }}>
        {tabs.map(t => (
          <button key={t.key} className={`btn btn-sm ${tab === t.key ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card" style={{ padding: "var(--space-2xl)", textAlign: "center" }}>
          <div className="animate-glow" style={{ width: "60%", height: 16, borderRadius: 4, background: "var(--border)", margin: "0 auto var(--space-md)" }} />
          <div className="animate-glow" style={{ width: "40%", height: 12, borderRadius: 4, background: "var(--border)", margin: "0 auto" }} />
        </div>
      ) : (
        <>
          {/* DASHBOARD TAB */}
          {tab === "dashboard" && data && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-md)", marginBottom: "var(--space-xl)" }}>
                {[
                  { label: "Total Tenants", value: data.totalTenants, icon: "👥" },
                  { label: "Active Missions", value: data.activeMissions, icon: "🚀" },
                  { label: "Total Missions", value: data.totalMissions, icon: "📋" },
                  { label: "Credits Used", value: data.totalCreditsUsed?.toLocaleString(), icon: "🪙" },
                ].map((stat, i) => (
                  <div key={i} className="card" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
                    <div style={{ fontSize: "1.5rem" }}>{stat.icon}</div>
                    <div style={{ fontSize: "1.8rem", fontWeight: 800, margin: "var(--space-xs) 0" }}>{stat.value}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Plan distribution */}
              <div className="card" style={{ padding: "var(--space-lg)", marginBottom: "var(--space-xl)" }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "var(--space-md)" }}>Plan Distribution</h3>
                <div className="row" style={{ gap: "var(--space-lg)", flexWrap: "wrap" }}>
                  {Object.entries(data.planDistribution || {}).map(([plan, count]) => (
                    <div key={plan} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{count as number}</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "capitalize" }}>{plan}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent events */}
              <div className="card" style={{ padding: "var(--space-lg)" }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "var(--space-md)" }}>Recent Activity</h3>
                {(data.recentEvents || []).slice(0, 10).map((e: any, i: number) => (
                  <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "0.78rem", display: "flex", justifyContent: "space-between" }}>
                    <span><code style={{ fontSize: "0.72rem", color: "var(--accent)" }}>{e.event_type}</code></span>
                    <span style={{ color: "var(--text-muted)" }}>{new Date(e.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CONNECTORS TAB */}
          {tab === "connectors" && data && (
            <div className="card" style={{ padding: "var(--space-lg)" }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "var(--space-md)" }}>Connector Requests</h3>
              {(data.requests || []).length === 0 ? (
                <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "var(--space-xl)" }}>No pending requests</p>
              ) : (
                (data.requests || []).map((req: any) => (
                  <div key={req.id} className="card" style={{ padding: "var(--space-md)", marginBottom: "var(--space-sm)", background: "var(--bg-glass)" }}>
                    <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--space-sm)" }}>
                      <div>
                        <strong style={{ fontSize: "0.9rem" }}>{req.payload?.connectorLabel || 'Unknown'}</strong>
                        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginLeft: 8 }}>from {req.payload?.userEmail || 'anonymous'}</span>
                      </div>
                      <span className={`badge ${req.payload?.status === 'configured' ? 'badge-green' : 'badge-amber'}`}>
                        {req.payload?.status === 'configured' ? '✓ Configured' : '⏳ Pending'}
                      </span>
                    </div>
                    <div className="row" style={{ gap: "var(--space-sm)" }}>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{new Date(req.created_at).toLocaleDateString()}</span>
                      {req.payload?.status !== 'configured' && (
                        <button className="btn btn-primary btn-sm" onClick={() => handleMarkConfigured(req.id, req.payload?.connectorLabel)}>
                          ✓ Mark as Configured
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TENANTS TAB */}
          {tab === "tenants" && data && (
            <div className="card" style={{ padding: "var(--space-lg)", overflowX: "auto" }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "var(--space-md)" }}>Tenants ({(data.tenants || []).length})</h3>
              <table style={{ width: "100%", fontSize: "0.78rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "8px 12px" }}>Tenant ID</th>
                    <th style={{ padding: "8px 12px" }}>Plan</th>
                    <th style={{ padding: "8px 12px" }}>Credits</th>
                    <th style={{ padding: "8px 12px" }}>Model Tier</th>
                    <th style={{ padding: "8px 12px" }}>Status</th>
                    <th style={{ padding: "8px 12px" }}>Trial</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.tenants || []).map((t: any) => (
                    <tr key={t.tenant_id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px" }}><code style={{ fontSize: "0.7rem" }}>{t.tenant_id?.slice(0, 8)}...</code></td>
                      <td style={{ padding: "8px 12px" }}><span className={`badge ${t.plan === 'enterprise' ? 'badge-purple' : t.plan === 'pro' ? 'badge-blue' : t.plan === 'individual' ? 'badge-green' : 'badge-amber'}`}>{t.plan}</span></td>
                      <td style={{ padding: "8px 12px" }}>{t.credits_remaining}/{t.credits_total}</td>
                      <td style={{ padding: "8px 12px" }}>{t.model_tier}</td>
                      <td style={{ padding: "8px 12px" }}><span className={`badge ${t.billing_status === 'active' ? 'badge-green' : 'badge-amber'}`}>{t.billing_status || 'trial'}</span></td>
                      <td style={{ padding: "8px 12px" }}>{t.is_trial ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* MISSIONS TAB */}
          {tab === "missions" && data && (
            <div className="card" style={{ padding: "var(--space-lg)" }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "var(--space-md)" }}>Missions ({(data.missions || []).length})</h3>
              {(data.missions || []).map((m: any) => (
                <div key={m.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong style={{ fontSize: "0.85rem" }}>{m.title}</strong>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{m.agentCount} agents · {m.tenantId?.slice(0, 8)}...</div>
                  </div>
                  <div className="row" style={{ gap: "var(--space-sm)" }}>
                    <span className={`badge ${m.status === 'completed' ? 'badge-green' : m.status === 'active' ? 'badge-blue' : m.status === 'failed' ? 'badge-red' : 'badge-amber'}`}>{m.status}</span>
                    <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{new Date(m.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ADD ADMIN MODAL */}
      {showAddAdmin && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={() => setShowAddAdmin(false)}>
          <div className="card" style={{ maxWidth: 500, width: "90%", padding: "var(--space-xl)", maxHeight: "80vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "var(--space-lg)" }}>👤 Manage Admin Users</h3>

            {/* Existing admins */}
            <div style={{ marginBottom: "var(--space-lg)" }}>
              {adminList.map(admin => (
                <div key={admin.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>{admin.email}</span>
                    {admin.is_primary && <span className="badge badge-purple" style={{ marginLeft: 8, fontSize: "0.65rem" }}>Primary</span>}
                    <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                      Last login: {admin.last_login ? new Date(admin.last_login).toLocaleString() : 'Never'}
                    </div>
                  </div>
                  {!admin.is_primary && (
                    <button className="btn btn-ghost btn-sm" style={{ color: "var(--ruby)" }} onClick={() => handleRemoveAdmin(admin.id)}>🗑</button>
                  )}
                </div>
              ))}
            </div>

            {/* Add new admin form */}
            <div style={{ padding: "var(--space-md)", background: "var(--bg-glass)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
              <h4 style={{ fontSize: "0.88rem", fontWeight: 600, marginBottom: "var(--space-md)" }}>Add New Admin</h4>
              <input
                type="email"
                placeholder="Email address"
                value={newAdminEmail}
                onChange={e => setNewAdminEmail(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }}
              />
              <input
                type="password"
                placeholder="Password (min 8 characters)"
                value={newAdminPassword}
                onChange={e => setNewAdminPassword(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-md)" }}
              />
              <button className="btn btn-primary btn-sm" onClick={handleAddAdmin} disabled={adminActionLoading || !newAdminEmail || newAdminPassword.length < 8}>
                {adminActionLoading ? "Adding..." : "➕ Add Admin"}
              </button>
            </div>

            <div style={{ marginTop: "var(--space-lg)", textAlign: "right" }}>
              <button className="btn btn-ghost" onClick={() => setShowAddAdmin(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "var(--bg-card)", border: "1px solid var(--border)", padding: "12px 20px", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", fontSize: "0.85rem", zIndex: 10000 }}>
          {toast}
        </div>
      )}
    </>
  );
}
