"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import ConnectorLogo from "@/components/ConnectorLogos";

interface AuthPopupContextType {
  triggerAuth: (provider?: string | null, onSuccess?: () => void) => void;
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
  const [show, setShow] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [successCallback, setSuccessCallback] = useState<(() => void) | null>(null);

  const triggerAuth = (authProvider: string | null = null, onSuccess?: () => void) => {
    setProvider(authProvider);
    if (onSuccess) {
      setSuccessCallback(() => onSuccess);
    } else {
      setSuccessCallback(null);
    }
    setShow(true);
  };

  useEffect(() => {
    if (!show) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "OAUTH_SUCCESS") {
        setShow(false);
        if (successCallback) {
          successCallback();
        }
      } else if (event.data?.type === "OAUTH_ERROR") {
        console.error("OAuth failed:", event.data.payload);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [show, successCallback]);

  return (
    <AuthPopupContext.Provider value={{ triggerAuth }}>
      {children}
      {show && (() => {
        // Clean display names for OAuth providers
        const DISPLAY_NAMES: Record<string, string> = {
          linkedin_oidc: 'LinkedIn', linkedin: 'LinkedIn',
          github: 'GitHub', slack: 'Slack', google: 'Google',
          notion: 'Notion', zoho: 'Zoho', discord: 'Discord',
          slack_oidc: 'Slack',
          twitter: 'X (Twitter)', facebook: 'Facebook', instagram: 'Instagram',
          whatsapp: 'WhatsApp', messenger: 'Messenger',
        };
        const displayName = provider 
          ? DISPLAY_NAMES[provider] || provider.charAt(0).toUpperCase() + provider.slice(1)
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
                <button 
                  className="oauth-btn" 
                  onClick={() => {
                    window.open(`/api/oauth/${provider}`, 'oauth_window', 'width=500,height=600');
                  }}
                >
                  <span className="oauth-name">Connect {displayName} Account</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>→</span>
                </button>
              ) : (
                [{p:"google",l:"Google"},{p:"linkedin_oidc",l:"LinkedIn"},{p:"slack_oidc",l:"Slack"}].map((o) => (
                  <button key={o.p} className="oauth-btn" onClick={() => { setShow(false); window.location.href = `/login?returnTo=/`; }}>
                    <span className="oauth-icon"><ConnectorLogo id={o.p === 'linkedin_oidc' ? 'linkedin' : o.p === 'slack_oidc' ? 'slack' : o.p} size={24} /></span>
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
    </AuthPopupContext.Provider>
  );
}
