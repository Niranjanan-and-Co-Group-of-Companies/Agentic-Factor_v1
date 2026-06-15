"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import ConnectorLogo from "@/components/ConnectorLogos";

// ── API Key connector definitions (for self-serve modal from mission page) ──
interface ApiKeyField { key: string; label: string; placeholder: string; type?: "text" | "password"; }
interface ApiKeyConnectorDef { label: string; logoId: string; fields: ApiKeyField[]; helpText: string; }

const API_KEY_CONNECTOR_DEFS: Record<string, ApiKeyConnectorDef> = {
  hunter: {
    label: "Hunter.io",
    logoId: "hunter",
    fields: [{ key: "apiKey", label: "API Key", placeholder: "Your Hunter.io API key" }],
    helpText: "Find in Hunter.io → Dashboard → API (free plan: 25 searches/month)",
  },
  sendgrid: {
    label: "SendGrid",
    logoId: "sendgrid",
    fields: [{ key: "apiKey", label: "API Key", placeholder: "SG..." }],
    helpText: "Find in SendGrid → Settings → API Keys",
  },
  stripe: {
    label: "Stripe",
    logoId: "stripe",
    fields: [{ key: "apiKey", label: "Secret Key", placeholder: "sk_live_..." }],
    helpText: "Find in Stripe Dashboard → Developers → API Keys",
  },
  twilio: {
    label: "Twilio",
    logoId: "twilio",
    fields: [
      { key: "accountSid", label: "Account SID", placeholder: "AC..." },
      { key: "authToken", label: "Auth Token", placeholder: "Your auth token", type: "password" },
    ],
    helpText: "Find in Twilio Console → Account Info",
  },
  openai_api: {
    label: "OpenAI",
    logoId: "openai_api",
    fields: [{ key: "apiKey", label: "API Key", placeholder: "sk-..." }],
    helpText: "Find in OpenAI Platform → API Keys",
  },
  replicate: {
    label: "Replicate",
    logoId: "replicate",
    fields: [{ key: "apiKey", label: "API Token", placeholder: "r8_..." }],
    helpText: "Find in Replicate → Account → API Tokens",
  },
  aws: {
    label: "Amazon Web Services",
    logoId: "aws",
    fields: [
      { key: "accessKeyId", label: "Access Key ID", placeholder: "AKIA..." },
      { key: "secretAccessKey", label: "Secret Access Key", placeholder: "Your secret key", type: "password" },
    ],
    helpText: "Find in AWS Console → IAM → Security Credentials",
  },
};

interface AuthPopupContextType {
  triggerAuth: (provider?: string | null, onSuccess?: () => void) => void;
  triggerApiKey: (provider: string, onSuccess?: () => void) => void;
}

const AuthPopupContext = createContext<AuthPopupContextType | undefined>(undefined);

export function useAuthPopup() {
  const context = useContext(AuthPopupContext);
  if (!context) {
    throw new Error("useAuthPopup must be used within an AuthPopupProvider");
  }
  return context;
}

export function AuthPopupProvider({ children }: { children: React.ReactNode }) {
  // ── OAuth state ──
  const [show, setShow] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [successCallback, setSuccessCallback] = useState<(() => void) | null>(null);

  // ── API key state ──
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyProvider, setApiKeyProvider] = useState<string | null>(null);
  const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({});
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyVerified, setApiKeyVerified] = useState(false);
  const [apiKeyAccountInfo, setApiKeyAccountInfo] = useState<string | null>(null);
  const [apiKeyCallback, setApiKeyCallback] = useState<(() => void) | null>(null);

  const triggerAuth = (authProvider: string | null = null, onSuccess?: () => void) => {
    setProvider(authProvider);
    setSuccessCallback(onSuccess ? () => onSuccess : null);
    setShow(true);
  };

  const triggerApiKey = (apkProvider: string, onSuccess?: () => void) => {
    setApiKeyProvider(apkProvider);
    setApiKeyValues({});
    setApiKeyError(null);
    setApiKeyVerified(false);
    setApiKeyAccountInfo(null);
    setApiKeyCallback(onSuccess ? () => onSuccess : null);
    setShowApiKey(true);
  };

  // OAuth success listener
  useEffect(() => {
    if (!show) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "OAUTH_SUCCESS") {
        setShow(false);
        if (successCallback) successCallback();
      } else if (event.data?.type === "OAUTH_ERROR") {
        console.error("OAuth failed:", event.data.payload);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [show, successCallback]);

  const handleApiKeySubmit = async () => {
    if (!apiKeyProvider) return;
    setApiKeySaving(true);
    setApiKeyError(null);
    setApiKeyVerified(false);
    setApiKeyAccountInfo(null);

    const emptyFields = Object.values(apiKeyValues).filter(v => !v?.trim());
    const def = API_KEY_CONNECTOR_DEFS[apiKeyProvider];
    if (def && emptyFields.length === def.fields.length) {
      setApiKeyError("Please fill in all required fields.");
      setApiKeySaving(false);
      return;
    }

    try {
      // Step 1: Verify the key against the real API
      const verifyRes = await fetch('/api/connectors/apikey/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: apiKeyProvider, fields: apiKeyValues }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyData.verified) {
        setApiKeyError(verifyData.error || "Invalid credentials. Please check and try again.");
        setApiKeySaving(false);
        return;
      }

      // Step 2: Save to tenant_permissions
      const saveRes = await fetch('/api/connectors/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: apiKeyProvider, fields: apiKeyValues }),
      });
      const saveData = await saveRes.json();

      if (!saveRes.ok) {
        setApiKeyError(saveData.error || "Failed to save credentials.");
        setApiKeySaving(false);
        return;
      }

      // Step 3: Show verified state, then close and resume
      setApiKeyVerified(true);
      setApiKeyAccountInfo(verifyData.accountInfo || null);

      setTimeout(() => {
        setShowApiKey(false);
        setApiKeyValues({});
        setApiKeyVerified(false);
        if (apiKeyCallback) apiKeyCallback();
      }, 1800);

    } catch (err) {
      setApiKeyError(`Network error: ${(err as Error).message}`);
    }

    setApiKeySaving(false);
  };

  const OAUTH_DISPLAY_NAMES: Record<string, string> = {
    linkedin_oidc: 'LinkedIn', linkedin: 'LinkedIn',
    github: 'GitHub', slack: 'Slack', google: 'Google',
    notion: 'Notion', zoho: 'Zoho', discord: 'Discord',
    slack_oidc: 'Slack',
    twitter: 'X (Twitter)', facebook: 'Facebook', instagram: 'Instagram',
    whatsapp: 'WhatsApp', messenger: 'Messenger',
    hubspot: 'HubSpot', salesforce: 'Salesforce', mailchimp: 'Mailchimp',
    atlassian: 'Atlassian', monday: 'Monday.com', asana: 'Asana',
  };

  const apiKeyDef = apiKeyProvider ? (API_KEY_CONNECTOR_DEFS[apiKeyProvider] ?? {
    label: apiKeyProvider.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    logoId: apiKeyProvider,
    fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your API key' }],
    helpText: '',
  }) : null;

  return (
    <AuthPopupContext.Provider value={{ triggerAuth, triggerApiKey }}>
      {children}

      {/* ── OAuth Popup ── */}
      {show && (() => {
        const displayName = provider
          ? OAUTH_DISPLAY_NAMES[provider] || provider.charAt(0).toUpperCase() + provider.slice(1)
          : null;
        return (
          <div className="auth-overlay" onClick={() => setShow(false)} style={{ zIndex: 9999 }}>
            <div className="auth-popup" onClick={(e) => e.stopPropagation()}>
              <div style={{ textAlign: "center", marginBottom: "var(--space-lg)" }}>
                <div style={{ fontSize: "2rem", marginBottom: "var(--space-sm)" }}>🔒</div>
                <h2 style={{ fontSize: "1.3rem", fontWeight: 700 }}>
                  {displayName ? `Connect ${displayName}` : "Sign In to Continue"}
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "var(--space-xs)" }}>
                  {displayName
                    ? `The AI Agents require access to ${displayName} to complete this mission.`
                    : "Please sign in to proceed."}
                </p>
              </div>

              <div className="stack" style={{ gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
                {provider ? (
                  <button className="oauth-btn" onClick={() => {
                    window.open(`/api/oauth/${provider}`, 'oauth_window', 'width=500,height=600');
                  }}>
                    <span className="oauth-name">Connect {displayName} Account</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>→</span>
                  </button>
                ) : (
                  [{ p: "google", l: "Google" }, { p: "linkedin_oidc", l: "LinkedIn" }, { p: "slack_oidc", l: "Slack" }].map((o) => (
                    <button key={o.p} className="oauth-btn" onClick={() => { setShow(false); window.location.href = `/login?returnTo=/`; }}>
                      <span className="oauth-icon">
                        <ConnectorLogo id={o.p === 'linkedin_oidc' ? 'linkedin' : o.p === 'slack_oidc' ? 'slack' : o.p} size={24} />
                      </span>
                      <span className="oauth-name">{o.l}</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>→</span>
                    </button>
                  ))
                )}
              </div>

              {!provider && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", marginBottom: "var(--space-md)" }}>
                    <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>or skip for demo</span>
                    <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                  </div>
                  <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => {
                    setShow(false);
                    if (successCallback) successCallback();
                  }}>
                    ⚡ Continue as Demo User
                  </button>
                </>
              )}

              <button className="btn btn-ghost" style={{ width: "100%", marginTop: "var(--space-xs)" }} onClick={() => setShow(false)}>
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── API Key Popup ── */}
      {showApiKey && apiKeyDef && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: "1rem" }}
          onClick={() => { if (!apiKeySaving) { setShowApiKey(false); setApiKeyValues({}); } }}
        >
          <div
            className="card"
            style={{ width: "100%", maxWidth: 480, padding: "var(--space-xl)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--space-lg)" }}>
              <div className="row" style={{ gap: "var(--space-sm)" }}>
                <ConnectorLogo id={apiKeyDef.logoId} size={40} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>Connect {apiKeyDef.label}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    🔑 API Key — your mission needs this to continue
                  </div>
                </div>
              </div>
              {!apiKeySaving && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setShowApiKey(false); setApiKeyValues({}); }} style={{ flexShrink: 0 }}>
                  ✕
                </button>
              )}
            </div>

            {/* Help text */}
            {apiKeyDef.helpText && (
              <div style={{ padding: "var(--space-sm) var(--space-md)", background: "var(--bg-glass)", borderRadius: "var(--radius-sm)", fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: "var(--space-lg)", borderLeft: "3px solid var(--accent)" }}>
                ℹ️ {apiKeyDef.helpText}
              </div>
            )}

            {/* Verified state */}
            {apiKeyVerified ? (
              <div style={{ padding: "var(--space-lg)", textAlign: "center" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-sm)" }}>✅</div>
                <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--emerald)", marginBottom: 4 }}>
                  {apiKeyDef.label} Connected!
                </div>
                {apiKeyAccountInfo && (
                  <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: "var(--space-sm)" }}>
                    {apiKeyAccountInfo}
                  </div>
                )}
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Resuming your mission…</div>
              </div>
            ) : (
              <>
                {/* Fields */}
                {apiKeyDef.fields.map((field) => (
                  <div key={field.key} style={{ marginBottom: "var(--space-md)" }}>
                    <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: 4 }}>
                      {field.label}
                    </label>
                    <input
                      className="input"
                      type={field.type || "text"}
                      placeholder={field.placeholder}
                      value={apiKeyValues[field.key] || ""}
                      onChange={(e) => setApiKeyValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && !apiKeySaving && handleApiKeySubmit()}
                      style={{ fontSize: "0.85rem", fontFamily: field.type === "password" ? "inherit" : "monospace" }}
                      autoComplete="off"
                      disabled={apiKeySaving}
                    />
                  </div>
                ))}

                {/* Error */}
                {apiKeyError && (
                  <div style={{ padding: "var(--space-sm) var(--space-md)", background: "hsla(0,84%,60%,0.1)", borderRadius: "var(--radius-sm)", border: "1px solid hsla(0,84%,60%,0.3)", fontSize: "0.8rem", color: "hsl(0,84%,70%)", marginBottom: "var(--space-md)" }}>
                    ❌ {apiKeyError}
                  </div>
                )}

                {/* Actions */}
                <div className="row" style={{ gap: "var(--space-sm)", justifyContent: "flex-end", marginTop: "var(--space-md)" }}>
                  <button className="btn btn-ghost" onClick={() => { setShowApiKey(false); setApiKeyValues({}); }} disabled={apiKeySaving}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={handleApiKeySubmit} disabled={apiKeySaving}>
                    {apiKeySaving ? "Verifying…" : "Verify & Save →"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AuthPopupContext.Provider>
  );
}
