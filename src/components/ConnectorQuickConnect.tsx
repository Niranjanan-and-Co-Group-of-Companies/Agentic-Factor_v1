"use client";
import { useState } from "react";

// Registry of known connectors and their fields — mirrors connectors page definitions
// Used so the missions page can show the right form per connector without navigating away

interface FieldDef { key: string; label: string; placeholder: string; type?: string; }

interface ConnectorInfo {
  label: string;
  icon: string;
  connectionType: 'oauth' | 'apikey' | 'custom';
  fields?: FieldDef[];
  helpText?: string;
  oauthRoute?: string;
}

const KNOWN_CONNECTORS: Record<string, ConnectorInfo> = {
  google:      { label: 'Google Workspace', icon: '📧', connectionType: 'oauth', oauthRoute: 'google', helpText: 'Connects Gmail, Calendar, Sheets and Drive.' },
  slack:       { label: 'Slack', icon: '💬', connectionType: 'oauth', oauthRoute: 'slack' },
  github:      { label: 'GitHub', icon: '🐙', connectionType: 'oauth', oauthRoute: 'github' },
  notion:      { label: 'Notion', icon: '📝', connectionType: 'oauth', oauthRoute: 'notion' },
  hubspot:     { label: 'HubSpot', icon: '🧲', connectionType: 'oauth', oauthRoute: 'hubspot' },
  salesforce:  { label: 'Salesforce', icon: '☁️', connectionType: 'oauth', oauthRoute: 'salesforce' },
  zoho:        { label: 'Zoho CRM', icon: '📊', connectionType: 'oauth', oauthRoute: 'zoho' },
  airtable:    { label: 'Airtable', icon: '📊', connectionType: 'oauth', oauthRoute: 'airtable' },
  discord:     { label: 'Discord', icon: '🎮', connectionType: 'oauth', oauthRoute: 'discord' },
  twitter:     { label: 'X (Twitter)', icon: '🐦', connectionType: 'oauth', oauthRoute: 'twitter' },
  microsoft:   { label: 'Microsoft 365', icon: '🪟', connectionType: 'oauth', oauthRoute: 'microsoft' },
  atlassian:   { label: 'Jira / Atlassian', icon: '📋', connectionType: 'oauth', oauthRoute: 'atlassian' },
  monday:      { label: 'Monday.com', icon: '📅', connectionType: 'oauth', oauthRoute: 'monday' },
  asana:       { label: 'Asana', icon: '🎯', connectionType: 'oauth', oauthRoute: 'asana' },
  mailchimp:   { label: 'Mailchimp', icon: '🐒', connectionType: 'oauth', oauthRoute: 'mailchimp' },
  stripe:      { label: 'Stripe', icon: '💳', connectionType: 'apikey', fields: [{ key: 'apiKey', label: 'Secret Key', placeholder: 'sk_live_...' }], helpText: 'Stripe Dashboard → Developers → API Keys' },
  twilio:      { label: 'Twilio', icon: '📞', connectionType: 'apikey', fields: [{ key: 'accountSid', label: 'Account SID', placeholder: 'AC...' }, { key: 'authToken', label: 'Auth Token', placeholder: 'Your auth token' }], helpText: 'Twilio Console → Account Info' },
  sendgrid:    { label: 'SendGrid', icon: '✉️', connectionType: 'apikey', fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'SG...' }] },
  apollo:      { label: 'Apollo.io', icon: '🔭', connectionType: 'apikey', fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Apollo API key' }] },
  calendly:    { label: 'Calendly', icon: '📅', connectionType: 'apikey', fields: [{ key: 'apiKey', label: 'Personal Access Token', placeholder: 'Your Calendly token' }] },
  hunter:      { label: 'Hunter.io', icon: '🎯', connectionType: 'apikey', fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Hunter.io API key' }] },
  vapi:        { label: 'Vapi.ai', icon: '📞', connectionType: 'apikey', fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Vapi API key' }], helpText: 'Vapi Dashboard → Account → API Keys' },
  elevenlabs:  { label: 'ElevenLabs', icon: '🎙️', connectionType: 'apikey', fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your ElevenLabs API key' }] },
  deepgram:    { label: 'Deepgram', icon: '🎤', connectionType: 'apikey', fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Deepgram API key' }] },
  linear:      { label: 'Linear', icon: '⚡', connectionType: 'apikey', fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'lin_api_...' }] },
  zendesk:     { label: 'Zendesk', icon: '🎧', connectionType: 'apikey', fields: [{ key: 'email', label: 'Agent Email', placeholder: 'you@company.com' }, { key: 'token', label: 'API Token', placeholder: 'Your Zendesk API token' }, { key: 'subdomain', label: 'Subdomain', placeholder: 'yourcompany' }] },
  shopify:     { label: 'Shopify', icon: '🛍️', connectionType: 'apikey', fields: [{ key: 'apiKey', label: 'Access Token', placeholder: 'shpat_...' }, { key: 'shop', label: 'Shop Domain', placeholder: 'mystore.myshopify.com' }] },
};

interface Props {
  provider: string;
  onConnected: () => void;
  onClose: () => void;
}

export default function ConnectorQuickConnect({ provider, onConnected, onClose }: Props) {
  const isCustom = provider.startsWith('custom_');
  const baseProvider = isCustom ? provider.replace('custom_', '') : provider;
  const info = KNOWN_CONNECTORS[baseProvider];

  const [fields, setFields] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState({ name: baseProvider, api_key: '', base_url: '', auth_type: 'bearer' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const label = info?.label ?? (isCustom ? baseProvider : provider);
  const icon = info?.icon ?? '🔌';

  const handleOAuth = () => {
    const route = info?.oauthRoute ?? provider;
    window.open(`/api/oauth/${route}`, 'oauth_window', 'width=500,height=600,scrollbars=yes');
    const check = setInterval(() => {
      // Poll — parent will re-check connection status via onConnected after a short delay
    }, 500);
    setTimeout(() => { clearInterval(check); onConnected(); }, 3000);
  };

  const handleApiKey = async () => {
    setSaving(true);
    setError(null);
    try {
      const verifyRes = await fetch('/api/connectors/apikey/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: baseProvider, fields }),
      });
      const verifyData = await verifyRes.json() as { verified: boolean; error?: string };
      if (!verifyData.verified) { setError(verifyData.error ?? 'Invalid credentials'); setSaving(false); return; }

      const saveRes = await fetch('/api/connectors/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: baseProvider, fields }),
      });
      if (!saveRes.ok) { setError('Failed to save credentials'); setSaving(false); return; }
      setDone(true);
      setTimeout(() => { onConnected(); }, 1200);
    } catch { setError('Network error'); }
    setSaving(false);
  };

  const handleCustom = async () => {
    if (!customFields.name.trim() || !customFields.api_key.trim()) { setError('Name and API key are required'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/connectors/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(customFields),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!data.success) { setError(data.error ?? 'Failed to save'); setSaving(false); return; }
      setDone(true);
      setTimeout(() => { onConnected(); }, 1200);
    } catch { setError('Network error'); }
    setSaving(false);
  };

  const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--space-xl)' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }}
      onClick={onClose}>
      <div style={{ ...card, width: '100%', maxWidth: 440 }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.5rem' }}>{icon}</span>
            <div>
              <div style={{ fontWeight: 700 }}>Connect {label}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Required by this mission</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>✅</div>
            <div style={{ fontWeight: 700, color: 'var(--emerald)' }}>{label} Connected!</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>You can now re-run the mission.</div>
          </div>
        ) : info?.connectionType === 'oauth' ? (
          <>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 'var(--space-lg)', lineHeight: 1.5 }}>
              Click below to authorise AgenticFactor to access your {label} account via OAuth. A popup will open.
            </div>
            {info.helpText && (
              <div style={{ padding: 'var(--space-sm) var(--space-md)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 'var(--space-lg)', borderLeft: '3px solid var(--accent)' }}>
                ℹ️ {info.helpText}
              </div>
            )}
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleOAuth}>
              Connect {label} →
            </button>
          </>
        ) : isCustom || !info ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {[
                { key: 'name', label: 'Connector Name', placeholder: `e.g. ${label}`, type: 'text' },
                { key: 'api_key', label: 'API Key / Token', placeholder: 'Your secret key', type: 'password' },
                { key: 'base_url', label: 'Base URL (optional)', placeholder: 'https://api.example.com', type: 'text' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>{f.label}</label>
                  <input className="input" type={f.type} placeholder={f.placeholder}
                    value={customFields[f.key as keyof typeof customFields]}
                    onChange={e => setCustomFields(p => ({ ...p, [f.key]: e.target.value }))} />
                </div>
              ))}
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Auth Type</label>
                <select className="input" value={customFields.auth_type} onChange={e => setCustomFields(p => ({ ...p, auth_type: e.target.value }))}>
                  <option value="bearer">Bearer Token</option>
                  <option value="apikey">X-API-Key Header</option>
                  <option value="basic">Basic Auth</option>
                  <option value="token">Token</option>
                </select>
              </div>
            </div>
            {error && <div style={{ padding: 'var(--space-sm)', color: 'hsl(0,84%,70%)', fontSize: '0.8rem', marginTop: 'var(--space-md)' }}>❌ {error}</div>}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 'var(--space-lg)' }} onClick={handleCustom} disabled={saving}>
              {saving ? 'Saving…' : 'Save & Connect →'}
            </button>
          </>
        ) : (
          <>
            {info.helpText && (
              <div style={{ padding: 'var(--space-sm) var(--space-md)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 'var(--space-lg)', borderLeft: '3px solid var(--accent)' }}>
                ℹ️ {info.helpText}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {(info.fields ?? []).map(f => (
                <div key={f.key}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>{f.label}</label>
                  <input className="input" type={f.type ?? 'text'} placeholder={f.placeholder}
                    value={fields[f.key] ?? ''}
                    onChange={e => setFields(p => ({ ...p, [f.key]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && !saving && handleApiKey()} />
                </div>
              ))}
            </div>
            {error && <div style={{ padding: 'var(--space-sm)', color: 'hsl(0,84%,70%)', fontSize: '0.8rem', marginTop: 'var(--space-md)' }}>❌ {error}</div>}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 'var(--space-lg)' }} onClick={handleApiKey} disabled={saving}>
              {saving ? 'Verifying…' : 'Verify & Connect →'}
            </button>
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: 'var(--space-md)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Or go to <a href="/connectors" style={{ color: 'var(--accent)' }}>Connectors page</a> to manage all connections
        </div>
      </div>
    </div>
  );
}
