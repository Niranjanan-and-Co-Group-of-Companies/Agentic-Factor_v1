"use client";
import { useState, useEffect } from "react";

// ============================================================
// Admin Dashboard — Overview, Connectors, Tenants, Missions
// With Add/Remove Admin Users popup.
// ============================================================

type Tab = "dashboard" | "connectors" | "tenants" | "missions" | "models" | "connector_defs";

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

  // Add Model/Connector modals
  const [showAddModel, setShowAddModel] = useState(false);
  const [showAddConnector, setShowAddConnector] = useState(false);
  const [newModel, setNewModel] = useState({ provider: 'anthropic', model_name: '', display_name: '', tier: 2, priority: 1 });
  const [newConnector, setNewConnector] = useState({ id: '', label: '', description: '', category: 'productivity', status: 'request_access', provider: '' });

  // Edit Model/Connector modals
  const [editingModel, setEditingModel] = useState<any>(null);
  const [editingConnector, setEditingConnector] = useState<any>(null);

  // Password reset
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

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
    const res = await fetch("/api/mgmt-x7k9/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_connector_configured", eventId, connectorId }),
    });
    const data = await res.json().catch(() => ({ notified: 0 }));
    const n = data.notified ?? 0;
    setToast(`✅ Connector marked as configured. ${n} customer${n === 1 ? "" : "s"} notified.`);
    fetchData();
    setTimeout(() => setToast(null), 4000);
  };

  const handleAddModel = async () => {
    if (!newModel.model_name || !newModel.display_name) return;
    setAdminActionLoading(true);
    const res = await fetch('/api/mgmt-x7k9/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_model', ...newModel }),
    });
    setAdminActionLoading(false);
    if (res.ok) {
      setToast('✅ Model added');
      setNewModel({ provider: 'anthropic', model_name: '', display_name: '', tier: 2, priority: 1 });
      setShowAddModel(false);
      fetchData();
    } else {
      const d = await res.json();
      setToast(`❌ ${d.error}`);
    }
    setTimeout(() => setToast(null), 4000);
  };

  const handleAddConnector = async () => {
    if (!newConnector.id || !newConnector.label) return;
    setAdminActionLoading(true);
    const res = await fetch('/api/mgmt-x7k9/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_connector', ...newConnector }),
    });
    setAdminActionLoading(false);
    if (res.ok) {
      setToast('✅ Connector added');
      setNewConnector({ id: '', label: '', description: '', category: 'productivity', status: 'request_access', provider: '' });
      setShowAddConnector(false);
      fetchData();
    } else {
      const d = await res.json();
      setToast(`❌ ${d.error}`);
    }
    setTimeout(() => setToast(null), 4000);
  };

  const handlePasswordReset = async () => {
    if (!currentPassword || !newPw || newPw !== confirmPw || newPw.length < 8) {
      setToast('❌ Passwords must match and be at least 8 characters');
      setTimeout(() => setToast(null), 4000);
      return;
    }
    setAdminActionLoading(true);
    const res = await fetch('/api/mgmt-x7k9/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset_password', currentPassword, newPassword: newPw }),
    });
    setAdminActionLoading(false);
    const d = await res.json();
    if (res.ok) {
      setToast('✅ Password updated');
      setCurrentPassword(''); setNewPw(''); setConfirmPw('');
    } else {
      setToast(`❌ ${d.error}`);
    }
    setTimeout(() => setToast(null), 4000);
  };

  const handleEditModel = async () => {
    if (!editingModel) return;
    setAdminActionLoading(true);
    const res = await fetch('/api/mgmt-x7k9/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit_model', modelId: editingModel.id, provider: editingModel.provider, model_name: editingModel.model_name, display_name: editingModel.display_name, tier: editingModel.tier, priority: editingModel.priority }),
    });
    setAdminActionLoading(false);
    if (res.ok) { setToast('✅ Model updated'); setEditingModel(null); fetchData(); }
    else { const d = await res.json(); setToast(`❌ ${d.error}`); }
    setTimeout(() => setToast(null), 4000);
  };

  const handleEditConnector = async () => {
    if (!editingConnector) return;
    setAdminActionLoading(true);
    const res = await fetch('/api/mgmt-x7k9/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit_connector', connectorId: editingConnector.id, label: editingConnector.label, description: editingConnector.description, category: editingConnector.category, status: editingConnector.status, provider: editingConnector.provider }),
    });
    setAdminActionLoading(false);
    if (res.ok) { setToast('✅ Connector updated'); setEditingConnector(null); fetchData(); }
    else { const d = await res.json(); setToast(`❌ ${d.error}`); }
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
    { key: "models", label: "LLM Models", icon: "🧠" },
    { key: "connector_defs", label: "Connector Defs", icon: "⚙️" },
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
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowAddAdmin(true); fetchAdmins(); }}>👤 Admins</button>
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
          {/* LLM MODELS TAB */}
          {tab === "models" && data && (
            <div className="card" style={{ padding: "var(--space-lg)", overflowX: "auto" }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>LLM Model Registry ({(data.models || []).length})</h3>
                <span className="badge badge-blue">Self-Healing</span>
                <button className="btn btn-primary btn-sm" onClick={() => setShowAddModel(true)}>+ Add Model</button>
              </div>
              <table style={{ width: "100%", fontSize: "0.78rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "8px 12px" }}>Provider</th>
                    <th style={{ padding: "8px 12px" }}>Model</th>
                    <th style={{ padding: "8px 12px" }}>Tier</th>
                    <th style={{ padding: "8px 12px" }}>Priority</th>
                    <th style={{ padding: "8px 12px" }}>Health</th>
                    <th style={{ padding: "8px 12px" }}>Failures</th>
                    <th style={{ padding: "8px 12px" }}>Last Check</th>
                    <th style={{ padding: "8px 12px" }}>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.models || []).map((m: any) => (
                    <tr key={m.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px" }}><span className={`badge ${m.provider === 'anthropic' ? 'badge-purple' : m.provider === 'google' ? 'badge-blue' : 'badge-green'}`}>{m.provider}</span></td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: "0.72rem" }}>{m.model_name}</td>
                      <td style={{ padding: "8px 12px" }}>T{m.tier}</td>
                      <td style={{ padding: "8px 12px" }}>{m.priority}</td>
                      <td style={{ padding: "8px 12px" }}><span className={`badge ${m.health_status === 'healthy' ? 'badge-green' : m.health_status === 'degraded' ? 'badge-amber' : 'badge-red'}`}>{m.health_status}</span></td>
                      <td style={{ padding: "8px 12px" }}>{m.failure_count}</td>
                      <td style={{ padding: "8px 12px", fontSize: "0.68rem", color: "var(--text-muted)" }}>{m.last_health_check ? new Date(m.last_health_check).toLocaleString() : 'Never'}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <button
                          className={`btn btn-sm ${m.is_active ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={async () => {
                            await fetch('/api/mgmt-x7k9/data', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'toggle_model', modelId: m.id, isActive: !m.is_active }),
                            });
                            fetchData();
                          }}
                        >
                          {m.is_active ? '✅' : '❌'}
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={() => setEditingModel({...m})}>✏️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* CONNECTOR DEFINITIONS TAB */}
          {tab === "connector_defs" && data && (
            <div className="card" style={{ padding: "var(--space-lg)", overflowX: "auto" }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>Connector Definitions ({(data.connectors || []).length})</h3>
                <span className="badge badge-purple">DB-Driven</span>
                <button className="btn btn-primary btn-sm" onClick={() => setShowAddConnector(true)}>+ Add Connector</button>
              </div>
              <table style={{ width: "100%", fontSize: "0.78rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "8px 12px" }}>ID</th>
                    <th style={{ padding: "8px 12px" }}>Label</th>
                    <th style={{ padding: "8px 12px" }}>Category</th>
                    <th style={{ padding: "8px 12px" }}>Status</th>
                    <th style={{ padding: "8px 12px" }}>Provider</th>
                    <th style={{ padding: "8px 12px" }}>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.connectors || []).map((c: any) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: "0.72rem" }}>{c.id}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{c.label}</td>
                      <td style={{ padding: "8px 12px" }}><span className="badge badge-blue" style={{ fontSize: "0.65rem" }}>{c.category}</span></td>
                      <td style={{ padding: "8px 12px" }}><span className={`badge ${c.status === 'available' ? 'badge-green' : c.status === 'coming_soon' ? 'badge-amber' : 'badge-purple'}`}>{c.status}</span></td>
                      <td style={{ padding: "8px 12px", fontSize: "0.72rem", color: "var(--text-muted)" }}>{c.provider || '—'}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <button
                          className={`btn btn-sm ${c.is_active ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={async () => {
                            await fetch('/api/mgmt-x7k9/data', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'toggle_connector', connectorId: c.id, isActive: !c.is_active }),
                            });
                            fetchData();
                          }}
                        >
                          {c.is_active ? '✅' : '❌'}
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={() => setEditingConnector({...c})}>✏️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

            {/* Password Reset */}
            <div style={{ marginTop: "var(--space-lg)", padding: "var(--space-md)", background: "var(--bg-glass)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
              <h4 style={{ fontSize: "0.88rem", fontWeight: 600, marginBottom: "var(--space-md)" }}>🔒 Change Your Password</h4>
              <input type="password" placeholder="Current password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }} />
              <input type="password" placeholder="New password (min 8 chars)" value={newPw} onChange={e => setNewPw(e.target.value)} style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }} />
              <input type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-md)" }} />
              <button className="btn btn-primary btn-sm" onClick={handlePasswordReset} disabled={adminActionLoading || !currentPassword || newPw.length < 8 || newPw !== confirmPw}>
                {adminActionLoading ? "Updating..." : "🔒 Update Password"}
              </button>
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

      {/* ADD MODEL MODAL */}
      {showAddModel && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={() => setShowAddModel(false)}>
          <div className="card" style={{ maxWidth: 500, width: "90%", padding: "var(--space-xl)" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "var(--space-lg)" }}>🧠 Add LLM Model</h3>
            <select value={newModel.provider} onChange={e => setNewModel({...newModel, provider: e.target.value})} style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }}>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="google">Google (Gemini)</option>
              <option value="openai">OpenAI (GPT)</option>
            </select>
            <input placeholder="Model name (e.g. claude-sonnet-4-6)" value={newModel.model_name} onChange={e => setNewModel({...newModel, model_name: e.target.value})} style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }} />
            <input placeholder="Display name (e.g. Claude Sonnet 4)" value={newModel.display_name} onChange={e => setNewModel({...newModel, display_name: e.target.value})} style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }} />
            <div className="row" style={{ gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
              <select value={newModel.tier} onChange={e => setNewModel({...newModel, tier: Number(e.target.value)})} style={{ flex: 1, padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem" }}>
                <option value={1}>Tier 1 (Best)</option>
                <option value={2}>Tier 2 (Good)</option>
                <option value={3}>Tier 3 (Cheapest)</option>
              </select>
              <input type="number" placeholder="Priority" value={newModel.priority} onChange={e => setNewModel({...newModel, priority: Number(e.target.value)})} min={1} max={10} style={{ width: 80, padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem" }} />
            </div>
            <div className="row" style={{ gap: "var(--space-sm)", justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddModel(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleAddModel} disabled={adminActionLoading || !newModel.model_name || !newModel.display_name}>
                {adminActionLoading ? "Adding..." : "➕ Add Model"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD CONNECTOR MODAL */}
      {showAddConnector && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={() => setShowAddConnector(false)}>
          <div className="card" style={{ maxWidth: 500, width: "90%", padding: "var(--space-xl)" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "var(--space-lg)" }}>⚙️ Add Connector</h3>
            <input placeholder="ID slug (e.g. freshdesk)" value={newConnector.id} onChange={e => setNewConnector({...newConnector, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')})} style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }} />
            <input placeholder="Display label (e.g. Freshdesk)" value={newConnector.label} onChange={e => setNewConnector({...newConnector, label: e.target.value})} style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }} />
            <input placeholder="Description" value={newConnector.description} onChange={e => setNewConnector({...newConnector, description: e.target.value})} style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }} />
            <div className="row" style={{ gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
              <select value={newConnector.category} onChange={e => setNewConnector({...newConnector, category: e.target.value})} style={{ flex: 1, padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem" }}>
                <option value="communication">Communication</option>
                <option value="crm">CRM</option>
                <option value="devtools">Dev Tools</option>
                <option value="productivity">Productivity</option>
                <option value="social">Social</option>
                <option value="payments">Payments</option>
                <option value="ecommerce">E-Commerce</option>
                <option value="cloud">Cloud</option>
                <option value="analytics">Analytics</option>
                <option value="ai">AI / ML</option>
                <option value="storage">Storage</option>
                <option value="marketing">Marketing</option>
                <option value="hr">HR</option>
              </select>
              <select value={newConnector.status} onChange={e => setNewConnector({...newConnector, status: e.target.value})} style={{ flex: 1, padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem" }}>
                <option value="available">Available</option>
                <option value="coming_soon">Coming Soon</option>
                <option value="request_access">Request Access</option>
              </select>
            </div>
            <input placeholder="OAuth provider (optional, e.g. github)" value={newConnector.provider} onChange={e => setNewConnector({...newConnector, provider: e.target.value})} style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-md)" }} />
            <div className="row" style={{ gap: "var(--space-sm)", justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddConnector(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleAddConnector} disabled={adminActionLoading || !newConnector.id || !newConnector.label}>
                {adminActionLoading ? "Adding..." : "➕ Add Connector"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MODEL MODAL */}
      {editingModel && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={() => setEditingModel(null)}>
          <div className="card" style={{ maxWidth: 500, width: "90%", padding: "var(--space-xl)" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "var(--space-lg)" }}>✏️ Edit Model</h3>
            <select value={editingModel.provider} onChange={e => setEditingModel({...editingModel, provider: e.target.value})} style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }}>
              <option value="anthropic">Anthropic</option><option value="google">Google</option><option value="openai">OpenAI</option>
            </select>
            <input value={editingModel.model_name} onChange={e => setEditingModel({...editingModel, model_name: e.target.value})} placeholder="Model name" style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }} />
            <input value={editingModel.display_name} onChange={e => setEditingModel({...editingModel, display_name: e.target.value})} placeholder="Display name" style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }} />
            <div className="row" style={{ gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
              <select value={editingModel.tier} onChange={e => setEditingModel({...editingModel, tier: Number(e.target.value)})} style={{ flex: 1, padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem" }}>
                <option value={1}>Tier 1</option><option value={2}>Tier 2</option><option value={3}>Tier 3</option>
              </select>
              <input type="number" value={editingModel.priority} onChange={e => setEditingModel({...editingModel, priority: Number(e.target.value)})} min={1} max={10} style={{ width: 80, padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem" }} />
            </div>
            <div className="row" style={{ gap: "var(--space-sm)", justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingModel(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleEditModel} disabled={adminActionLoading}>{adminActionLoading ? "Saving..." : "💾 Save"}</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT CONNECTOR MODAL */}
      {editingConnector && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={() => setEditingConnector(null)}>
          <div className="card" style={{ maxWidth: 500, width: "90%", padding: "var(--space-xl)" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "var(--space-lg)" }}>✏️ Edit Connector: {editingConnector.id}</h3>
            <input value={editingConnector.label} onChange={e => setEditingConnector({...editingConnector, label: e.target.value})} placeholder="Label" style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }} />
            <input value={editingConnector.description || ''} onChange={e => setEditingConnector({...editingConnector, description: e.target.value})} placeholder="Description" style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-sm)" }} />
            <div className="row" style={{ gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
              <select value={editingConnector.category} onChange={e => setEditingConnector({...editingConnector, category: e.target.value})} style={{ flex: 1, padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem" }}>
                <option value="communication">Communication</option><option value="crm">CRM</option><option value="devtools">Dev Tools</option><option value="productivity">Productivity</option><option value="social">Social</option><option value="payments">Payments</option><option value="ecommerce">E-Commerce</option><option value="cloud">Cloud</option><option value="analytics">Analytics</option><option value="ai">AI / ML</option><option value="storage">Storage</option><option value="marketing">Marketing</option><option value="hr">HR</option>
              </select>
              <select value={editingConnector.status} onChange={e => setEditingConnector({...editingConnector, status: e.target.value})} style={{ flex: 1, padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem" }}>
                <option value="available">Available</option><option value="coming_soon">Coming Soon</option><option value="request_access">Request Access</option>
              </select>
            </div>
            <input value={editingConnector.provider || ''} onChange={e => setEditingConnector({...editingConnector, provider: e.target.value})} placeholder="OAuth provider (optional)" style={{ width: "100%", padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem", marginBottom: "var(--space-md)" }} />
            <div className="row" style={{ gap: "var(--space-sm)", justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingConnector(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleEditConnector} disabled={adminActionLoading}>{adminActionLoading ? "Saving..." : "💾 Save"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
