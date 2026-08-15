"use client";
import { useState, useEffect } from "react";

// All OAuth-based providers now connect through Composio.
// Composio manages token storage, refresh, and retries — no direct OAuth flow needed.
// Only pure API-key providers (Stripe, Twilio, etc.) bypass Composio.

interface FieldDef { key: string; label: string; placeholder: string; type?: string; }

interface ConnectorInfo {
  label: string;
  icon: string;
  // 'composio' = OAuth via Composio (covers all major OAuth apps)
  // 'apikey'   = direct API key stored in our vault (no OAuth involved)
  // 'custom'   = fully custom REST connector
  connectionType: 'composio' | 'apikey' | 'custom';
  composioSlug?: string;   // Composio toolkit slug (required when connectionType='composio')
  fields?: FieldDef[];
  helpText?: string;
}

// Maps our AF provider key → Composio toolkit slug for every supported app.
// ALL of these must connect via Composio OAuth — no legacy direct OAuth.
const KNOWN_CONNECTORS: Record<string, ConnectorInfo> = {
  // ── Google (Gmail, Calendar, Drive, Sheets) ──
  google:        { label: 'Google Workspace', icon: '📧', connectionType: 'composio', composioSlug: 'gmail',        helpText: 'Connects Gmail, Calendar, Drive, and Sheets.' },
  gmail:         { label: 'Gmail',            icon: '📧', connectionType: 'composio', composioSlug: 'gmail' },
  // ── Productivity & Collaboration ──
  slack:         { label: 'Slack',            icon: '💬', connectionType: 'composio', composioSlug: 'slack' },
  notion:        { label: 'Notion',           icon: '📝', connectionType: 'composio', composioSlug: 'notion' },
  discord:       { label: 'Discord',          icon: '🎮', connectionType: 'composio', composioSlug: 'discord' },
  microsoft:     { label: 'Microsoft 365',    icon: '🪟', connectionType: 'composio', composioSlug: 'outlook',      helpText: 'Connects Outlook, Teams, and OneDrive.' },
  // ── Project Management ──
  atlassian:     { label: 'Jira / Atlassian', icon: '📋', connectionType: 'composio', composioSlug: 'jira' },
  monday:        { label: 'Monday.com',       icon: '📅', connectionType: 'composio', composioSlug: 'mondaydotcom' },
  asana:         { label: 'Asana',            icon: '🎯', connectionType: 'composio', composioSlug: 'asana' },
  airtable:      { label: 'Airtable',         icon: '📊', connectionType: 'composio', composioSlug: 'airtable' },
  // ── Developer ──
  github:        { label: 'GitHub',           icon: '🐙', connectionType: 'composio', composioSlug: 'github' },
  linear:        { label: 'Linear',           icon: '⚡', connectionType: 'composio', composioSlug: 'linear' },
  // ── CRM & Sales ──
  hubspot:       { label: 'HubSpot',          icon: '🧲', connectionType: 'composio', composioSlug: 'hubspot' },
  salesforce:    { label: 'Salesforce',       icon: '☁️', connectionType: 'composio', composioSlug: 'salesforce' },
  zoho:          { label: 'Zoho CRM',         icon: '📊', connectionType: 'composio', composioSlug: 'zoho' },
  intercom:      { label: 'Intercom',         icon: '💬', connectionType: 'composio', composioSlug: 'intercom' },
  // ── Marketing ──
  mailchimp:     { label: 'Mailchimp',        icon: '🐒', connectionType: 'composio', composioSlug: 'mailchimp' },
  // ── Paid Advertising ──
  google_ads:       { label: 'Google Ads',        icon: '🎯', connectionType: 'composio', composioSlug: 'googleads',       helpText: 'Connects Google Ads for keyword research and campaign management. Requires a Google Ads account.' },
  google_analytics: { label: 'Google Analytics',  icon: '📈', connectionType: 'composio', composioSlug: 'googleanalytics', helpText: 'Connects Google Analytics 4 for audience and traffic data.' },
  facebook_ads:     { label: 'Meta Ads',           icon: '📣', connectionType: 'composio', composioSlug: 'facebookads',    helpText: 'Connects Meta Ads Manager for Facebook and Instagram campaigns. Requires an active Meta Business account.' },
  // ── Content & Video Platforms ──
  youtube:          { label: 'YouTube',            icon: '▶️',  connectionType: 'composio', composioSlug: 'youtube',        helpText: 'Upload videos, manage playlists, and schedule posts on YouTube.' },
  buffer:           { label: 'Buffer',             icon: '📅', connectionType: 'composio', composioSlug: 'buffer',         helpText: 'Schedule and publish social media posts across multiple platforms.' },
  canva:            { label: 'Canva',              icon: '🎨', connectionType: 'composio', composioSlug: 'canva',          helpText: 'Create and export designs, presentations, and graphics.' },
  // ── AI Creative Generation (API key) ──
  openai:           { label: 'OpenAI (DALL-E)',    icon: '🖼️',  connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'sk-...' }], helpText: 'Used for DALL-E 3 image generation. Get your key at platform.openai.com' },
  replicate:        { label: 'Replicate (Flux)',   icon: '✨', connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'API Token', placeholder: 'r8_...' }], helpText: 'Access Flux, Stable Diffusion, and 100s of other AI models via one key. Get yours at replicate.com' },
  heygen:           { label: 'HeyGen',             icon: '🎬', connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your HeyGen API key' }], helpText: 'AI presenter videos — an avatar reads your script on camera. Great for YouTube and ads. Get key at heygen.com' },
  runwayml:         { label: 'RunwayML',           icon: '🎥', connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your RunwayML API key' }], helpText: 'Text-to-video and image-to-video generation. Best for short clips, intros, and B-roll.' },
  // ── Social Media ──
  twitter:       { label: 'X (Twitter)',      icon: '🐦', connectionType: 'composio', composioSlug: 'twitter' },
  facebook:      { label: 'Facebook',         icon: '👥', connectionType: 'composio', composioSlug: 'facebook' },
  instagram:     { label: 'Instagram',        icon: '📸', connectionType: 'composio', composioSlug: 'instagram' },
  linkedin_oidc: { label: 'LinkedIn',         icon: '💼', connectionType: 'composio', composioSlug: 'linkedin' },
  reddit:        { label: 'Reddit',           icon: '🤖', connectionType: 'composio', composioSlug: 'reddit' },
  // ── Storage ──
  dropbox:       { label: 'Dropbox',          icon: '📦', connectionType: 'composio', composioSlug: 'dropbox' },
  // ── E-commerce ──
  shopify:       { label: 'Shopify',          icon: '🛍️', connectionType: 'composio', composioSlug: 'shopify' },
  paypal:        { label: 'PayPal',           icon: '💰', connectionType: 'composio', composioSlug: 'paypal' },
  // ── Customer Support ──
  zendesk:       { label: 'Zendesk',          icon: '🎧', connectionType: 'composio', composioSlug: 'zendesk' },
  // ── Payments (API key — no OAuth) ──
  stripe:        { label: 'Stripe',           icon: '💳', connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'Secret Key', placeholder: 'sk_live_...' }],   helpText: 'Stripe Dashboard → Developers → API Keys' },
  // ── Communication (API key) ──
  twilio:        { label: 'Twilio',           icon: '📞', connectionType: 'apikey',   fields: [{ key: 'accountSid', label: 'Account SID', placeholder: 'AC...' }, { key: 'authToken', label: 'Auth Token', placeholder: 'Your auth token' }], helpText: 'Twilio Console → Account Info' },
  sendgrid:      { label: 'SendGrid',         icon: '✉️', connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'SG...' }] },
  // ── Prospecting (API key) ──
  apollo:        { label: 'Apollo.io',        icon: '🔭', connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Apollo API key' }] },
  hunter:        { label: 'Hunter.io',        icon: '🎯', connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Hunter.io API key' }] },
  // ── Voice / AI (API key) ──
  vapi:          { label: 'Vapi.ai',          icon: '📞', connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Vapi API key' }],      helpText: 'Vapi Dashboard → Account → API Keys' },
  elevenlabs:    { label: 'ElevenLabs',       icon: '🎙️', connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your ElevenLabs API key' }] },
  deepgram:      { label: 'Deepgram',         icon: '🎤', connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Deepgram API key' }] },
  // ── Scheduling (API key) ──
  calendly:      { label: 'Calendly',         icon: '📅', connectionType: 'apikey',   fields: [{ key: 'apiKey', label: 'Personal Access Token', placeholder: 'Your Calendly token' }] },
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

  // Listen for Composio OAuth popup success/failure
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'OAUTH_SUCCESS') {
        setSaving(false);
        setDone(true);
        setTimeout(() => onConnected(), 1000);
      } else if (e.data?.type === 'OAUTH_ERROR') {
        setSaving(false);
        setError('Connection failed. Please try again or use the Connectors page.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onConnected]);

  // All OAuth providers go through Composio — no more direct legacy OAuth
  const handleComposioOAuth = async () => {
    setSaving(true);
    setError(null);
    const composioSlug = info?.composioSlug ?? baseProvider;
    try {
      const res = await fetch('/api/composio/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: composioSlug }),
      });
      const data = await res.json() as { authUrl?: string; error?: string };
      if (!res.ok || !data.authUrl) {
        setError(data.error ?? 'Could not start connection. Try from the Connectors page.');
        setSaving(false);
        return;
      }
      const popup = window.open(data.authUrl, 'oauth_window', 'width=500,height=700,scrollbars=yes');
      // Fallback poll in case postMessage doesn't fire (popup blocked or redirected without opener)
      const poll = setInterval(() => {
        if (popup?.closed) {
          clearInterval(poll);
          setSaving(false);
          setTimeout(() => onConnected(), 500);
        }
      }, 500);
    } catch {
      setError('Connection failed. Please try again or go to the Connectors page.');
      setSaving(false);
    }
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
      setTimeout(() => onConnected(), 1200);
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
      setTimeout(() => onConnected(), 1200);
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

        ) : info?.connectionType === 'composio' ? (
          // ── Composio OAuth ────────────────────────────────────
          <>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 'var(--space-lg)', lineHeight: 1.5 }}>
              Click below to authorise AgenticFactor to access your {label} account. A popup will open — complete the sign-in and it will close automatically.
            </div>
            {info.helpText && (
              <div style={{ padding: 'var(--space-sm) var(--space-md)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 'var(--space-lg)', borderLeft: '3px solid var(--accent)' }}>
                ℹ️ {info.helpText}
              </div>
            )}
            {error && (
              <div style={{ padding: 'var(--space-sm) var(--space-md)', background: 'var(--rose-bg)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--rose)', marginBottom: 'var(--space-md)' }}>
                ❌ {error}
              </div>
            )}
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleComposioOAuth} disabled={saving}>
              {saving ? 'Opening sign-in…' : `Connect ${label} →`}
            </button>
          </>

        ) : isCustom || !info ? (
          // ── Custom connector ──────────────────────────────────
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
          // ── API Key provider ──────────────────────────────────
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
