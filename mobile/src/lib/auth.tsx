// The signed-in session, and the three ways in: email and password, Google (in the phone's sign-in
// browser) and Sign in with Apple (iOS — Apple requires it next to Google).

import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { API_URL } from './config';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

interface AuthState {
  session: Session | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ session, loading: false }));
    return () => data.subscription.unsubscribe();
  }, []);
  return <AuthContext value={state}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  return use(AuthContext);
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

/** Creates the account; the confirmation link in the email opens the website, then they sign in here. */
export async function signUpWithEmail(email: string, password: string): Promise<'created' | 'exists'> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: `${API_URL}/auth/callback` },
  });
  if (error) throw error;
  if (data.user?.identities?.length === 0) return 'exists';
  fetch(`${API_URL}/api/auth/welcome-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), name: email.trim().split('@')[0] }),
  }).catch(() => {});
  return 'created';
}

/** Google, in the phone's sign-in browser; the code it returns is exchanged for a session. */
export async function signInWithGoogle(): Promise<void> {
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: globalThis.location?.origin } });
    if (error) throw error;
    return;
  }
  const redirectTo = Linking.createURL('auth-callback');
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data.url) throw error ?? new Error('Google sign-in could not start.');
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return; // closed by the user
  const { queryParams } = Linking.parse(result.url);
  const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
  if (!code) throw new Error(typeof queryParams?.error_description === 'string' ? queryParams.error_description : 'Google sign-in did not finish.');
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}

export const appleSignInAvailable = () => Platform.OS === 'ios' && AppleAuthentication.isAvailableAsync();

/** Sign in with Apple: Apple's token goes to Supabase with the nonce it was issued for. */
export async function signInWithApple(): Promise<void> {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
    throw err;
  }
  if (!credential.identityToken) throw new Error('Apple did not return a sign-in token.');
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
