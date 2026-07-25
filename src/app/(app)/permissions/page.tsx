"use client";
import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface ApiCredential {
  provider: string;
  scopes: string[];
  updated_at: string;
  created_at: string;
}

interface Permission {
  id: string; service: string; type: string; scope: string;
  confidentialityLevel: "public" | "internal" | "confidential" | "restricted";
  granted: boolean; missionTitle: string;
}

const levelColors: Record<string, string> = {
  public: "badge-green", internal: "badge-blue",
  confidential: "badge-amber", restricted: "badge-red",
};

const PROVIDER_LABELS: Record<string, string> = {
  hunter: "Hunter.io", apollo: "Apollo.io", stripe: "Stripe", sendgrid: "SendGrid",
  twilio: "Twilio", openai_api: "OpenAI", anthropic_api: "Anthropic", replicate: "Replicate",
  aws: "Amazon Web Services", vercel: "Vercel", supabase_ext: "Supabase", firebase: "Firebase",
  segment: "Segment", mixpanel: "Mixpanel", make: "Make (Integromat)", woocommerce: "WooCommerce",
  bamboohr: "BambooHR", heygen: "HeyGen", langsmith: "LangSmith", shiprocket: "Shiprocket",
  razorpay: "Razorpay", calendly: "Calendly", typeform: "Typeform",
};

const PROVIDER_ICONS: Record<string, string> = {
  hunter: "🎯", apollo: "🔭", stripe: "💳", sendgrid: "✉️", twilio: "📞",
  openai_api: "🤖", anthropic_api: "🧠", replicate: "🔬", aws: "🟧", vercel: "▲",
  supabase_ext: "⚡", firebase: "🔥", segment: "📡", mixpanel: "📈", make: "🔄",
  woocommerce: "🛒", bamboohr: "🎋", heygen: "🎬", langsmith: "🔗", shiprocket: "🚀",
  razorpay: "💸", calendly: "📅", typeform: "📝",
};

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function PermissionsPage() {
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Fetch connected API keys
    const credRes = await fetch('/api/connectors/apikey');
    if (credRes.ok) {
      const { credentials: creds } = await credRes.json() as { credentials: ApiCredential[] };
      setCredentials(creds ?? []);
    }

    // Fetch mission-requested permissions (legacy table — may not exist)
    try {
      const { data: rows } = await supabase
        .from("permissions")
        .select("id, service, type, scope, confidentiality_level, granted, mission_title")
        .eq("tenant_id", user.id)
        .order("created_at", { ascending: false });

      if (rows) {
        setPermissions(rows.map((r: Record<string, unknown>) => ({
          id: r.id as string,
          service: (r.service as string) || "Service",
          type: (r.type as string) || "api_key",
          scope: (r.scope as string) || "read",
          confidentialityLevel: (r.confidentiality_level as Permission["confidentialityLevel"]) || "internal",
          granted: (r.granted as boolean) ?? false,
          missionTitle: (r.mission_title as string) || "Mission",
        })));
      }
    } catch {
      // Table may not exist — silent
    }

    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const revokeCredential = async (provider: string) => {
    if (!confirm(`Revoke ${PROVIDER_LABELS[provider] ?? provider} credentials? This cannot be undone.`)) return;
    setRevoking(provider);
    const res = await fetch(`/api/connectors/apikey?provider=${provider}`, { method: 'DELETE' });
    if (res.ok) {
      setCredentials(prev => prev.filter(c => c.provider !== provider));
    }
    setRevoking(null);
  };

  const handlePermSave = async (permId: string) => {
    const value = secrets[permId];
    if (!value?.trim()) return;
    setSaving(permId);
    try {
      const supabase = getSupabase();
      await supabase.from("permissions").update({ granted: true }).eq("id", permId);
      setPermissions(prev => prev.map(p => p.id === permId ? { ...p, granted: true } : p));
    } catch { /* silent */ }
    setSaving(null);
    setSaved(permId);
    setTimeout(() => setSaved(null), 2000);
  };

  const card: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: "var(--radius)", padding: "var(--space-lg)",
  };

  if (loading) {
    return (
      <div className="page-container stack" style={{ gap: "var(--space-lg)" }}>
        <div style={{ fontWeight: 700, fontSize: "1.5rem" }}>Credentials</div>
        <div style={{ color: "var(--text-muted)" }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="page-container stack" style={{ gap: "var(--space-lg)", maxWidth: 860 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: "1.5rem" }}>Credentials</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: 4 }}>
          Manage connected API keys. Values are AES-256-GCM encrypted and only decrypted at agent runtime.
        </div>
      </div>

      {/* ── Connected API Keys ── */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-md)" }}>
          <div style={{ fontWeight: 600 }}>Connected API Keys</div>
          <a href="/connectors" style={{ fontSize: "0.85rem", color: "var(--accent)" }}>
            + Add connector →
          </a>
        </div>

        {credentials.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--space-xl)", color: "var(--text-muted)" }}>
            <div style={{ fontSize: "2rem", marginBottom: "var(--space-sm)" }}>🔌</div>
            <div>No API keys connected yet.</div>
            <a href="/connectors" style={{ color: "var(--accent)", fontSize: "0.9rem" }}>
              Go to Connectors →
            </a>
          </div>
        ) : (
          <div className="stack" style={{ gap: "var(--space-sm)" }}>
            {credentials.map((cred) => (
              <div key={cred.provider} style={{
                display: "flex", alignItems: "center", gap: "var(--space-md)",
                padding: "var(--space-sm) var(--space-md)",
                background: "var(--background)", borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: "1.4rem", width: 32, textAlign: "center" }}>
                  {PROVIDER_ICONS[cred.provider] ?? "🔑"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>
                    {PROVIDER_LABELS[cred.provider] ?? cred.provider}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Connected · Last updated {new Date(cred.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                  <span style={{ fontSize: "0.75rem", background: "color-mix(in srgb, var(--emerald) 15%, transparent)",
                    color: "var(--emerald)", borderRadius: 4, padding: "2px 8px", fontWeight: 600 }}>
                    ✓ Active
                  </span>
                  <button
                    onClick={() => revokeCredential(cred.provider)}
                    disabled={revoking === cred.provider}
                    style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                      color: "var(--rose)", cursor: "pointer", padding: "4px 10px", fontSize: "0.8rem",
                      opacity: revoking === cred.provider ? 0.5 : 1 }}>
                    {revoking === cred.provider ? "..." : "Revoke"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Mission-Requested Permissions (existing flow) ── */}
      {permissions.length > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: "var(--space-md)" }}>
            Mission Permission Requests
          </div>
          <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: "var(--space-md)" }}>
            These permissions were requested by your agent missions and require your approval.
          </div>
          <div className="stack" style={{ gap: "var(--space-sm)" }}>
            {permissions.map((perm) => (
              <div key={perm.id} style={{
                padding: "var(--space-md)", background: "var(--background)",
                borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-sm)" }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{perm.service}</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                      Mission: {perm.missionTitle} · Scope: <code style={{ color: "var(--accent)" }}>{perm.scope}</code>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                    <span className={`badge ${levelColors[perm.confidentialityLevel]}`}>{perm.confidentialityLevel}</span>
                    {perm.granted && <span className="badge badge-green">✓ Granted</span>}
                  </div>
                </div>
                {!perm.granted && (
                  <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                    <input
                      type="password"
                      placeholder={`Enter credential for ${perm.service}...`}
                      value={secrets[perm.id] || ""}
                      onChange={(e) => setSecrets(s => ({ ...s, [perm.id]: e.target.value }))}
                      style={{ flex: 1, padding: "var(--space-sm) var(--space-md)",
                        background: "var(--surface)", border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)", color: "var(--text)", fontSize: "0.85rem" }}
                    />
                    <button className="btn btn-primary"
                      onClick={() => handlePermSave(perm.id)}
                      disabled={saving === perm.id || !secrets[perm.id]?.trim()}>
                      {saving === perm.id ? "Saving..." : saved === perm.id ? "✓ Saved" : "Grant"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
