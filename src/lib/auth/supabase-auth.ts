import { createBrowserClient } from '@supabase/ssr';

// ============================================================
// Supabase Auth — Browser Client (Client Components)
// Uses @supabase/ssr for cookie-based session management.
// Handles OAuth flows, token refresh, and session persistence
// without custom token-refresh logic.
// ============================================================

export function createAuthClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ============================================================
// OAuth Providers — One-Click Connectors
// Supabase Auth Helpers handle the full OAuth lifecycle:
//   1. Redirect to provider
//   2. Exchange code for session
//   3. Auto-refresh tokens via cookies
// ============================================================

export type OAuthProvider = 'google' | 'linkedin_oidc' | 'slack_oidc' | 'azure';

interface OAuthConfig {
  provider: OAuthProvider;
  label: string;
  icon: string;
  scopes?: string;
  description: string;
}

export const OAUTH_PROVIDERS: OAuthConfig[] = [
  {
    provider: 'google',
    label: 'Google (Gmail)',
    icon: '📧',
    scopes: 'email profile https://www.googleapis.com/auth/gmail.readonly',
    description: 'Gmail access for email-based agents',
  },
  {
    provider: 'linkedin_oidc',
    label: 'LinkedIn',
    icon: '💼',
    scopes: 'openid profile email',
    description: 'LinkedIn data for networking agents',
  },
  {
    provider: 'slack_oidc',
    label: 'Slack',
    icon: '💬',
    scopes: 'openid profile email',
    description: 'Slack integration for notification agents',
  },
  {
    provider: 'azure',
    label: 'AWS / Azure',
    icon: '☁️',
    scopes: 'openid profile email',
    description: 'Cloud provider access for infrastructure agents',
  },
];

/**
 * Initiate OAuth sign-in. Supabase Auth Helpers handle the
 * full redirect → code exchange → cookie session flow.
 */
export async function signInWithOAuth(provider: OAuthProvider, scopes?: string) {
  const supabase = createAuthClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      scopes: scopes || undefined,
    },
  });
  return { data, error };
}

/**
 * Sign in with email/password (fallback).
 */
export async function signInWithEmail(email: string, password: string) {
  const supabase = createAuthClient();
  return supabase.auth.signInWithPassword({ email, password });
}

/**
 * Sign up with email/password.
 */
export async function signUpWithEmail(email: string, password: string) {
  const supabase = createAuthClient();
  return supabase.auth.signUp({ email, password });
}

/**
 * Get current session (cookie-based, auto-refreshed by @supabase/ssr).
 */
export async function getSession() {
  const supabase = createAuthClient();
  return supabase.auth.getSession();
}

/**
 * Get current user.
 */
export async function getUser() {
  const supabase = createAuthClient();
  return supabase.auth.getUser();
}

/**
 * Sign out (clears cookies via Supabase Auth Helpers).
 */
export async function signOut() {
  const supabase = createAuthClient();
  return supabase.auth.signOut();
}

/**
 * Listen for auth state changes.
 */
export function onAuthStateChange(callback: (event: string, session: unknown) => void) {
  const supabase = createAuthClient();
  return supabase.auth.onAuthStateChange(callback);
}
