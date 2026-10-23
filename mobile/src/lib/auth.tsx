// The signed-in session, and the three ways in: email and password, Google (the phone's own Google
// sheet, or the sign-in browser) and Sign in with Apple (iOS — Apple requires it next to Google).

import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
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

/** This build's Google client IDs (app.config.js): set, Google sign-in uses the phone's own Google sheet. */
const googleIds = Constants.expoConfig?.extra?.googleSignIn as { webClientId: string; iosClientId?: string } | undefined;

/**
 * Google: the phone's own Google sign-in sheet when this build has its client IDs (no browser, no
 * "continue to …supabase.co"); otherwise — and when the sheet can't be used here — the sign-in browser.
 */
export async function signInWithGoogle(): Promise<void> {
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: globalThis.location?.origin } });
    if (error) throw error;
    return;
  }
  const native = googleIds?.webClientId && (Platform.OS === 'android' || googleIds.iosClientId);
  if (native && (await signInWithGoogleSheet(googleIds)) !== 'unavailable') return;
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

/**
 * Google's own sheet; its token goes to Supabase. Google's iOS SDK puts its own nonce in the token and
 * doesn't share it, so Supabase's Google provider has "Skip nonce checks" on; the token is still checked
 * for this app's client IDs and expires within the hour.
 */
async function signInWithGoogleSheet(ids: { webClientId: string; iosClientId?: string }): Promise<'done' | 'cancelled' | 'unavailable'> {
  let token: string | null;
  try {
    const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = await import('@react-native-google-signin/google-signin');
    GoogleSignin.configure({ webClientId: ids.webClientId, ...(ids.iosClientId ? { iosClientId: ids.iosClientId } : {}) });
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    try {
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) return 'cancelled';
      token = response.data.idToken;
    } catch (err) {
      if (isErrorWithCode(err) && err.code === statusCodes.IN_PROGRESS) return 'cancelled';
      throw err;
    }
  } catch (err) {
    // Not set up for this phone (no Play services, an unregistered Android key…): use the browser instead.
    console.warn('[auth] Google sign-in sheet unavailable:', err);
    return 'unavailable';
  }
  if (!token) throw new Error('Google did not return a sign-in token.');
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token });
  if (error) throw error;
  return 'done';
}

/** Not in the test copy for free Apple accounts (app.config.js), which can't use Sign in with Apple. */
export const appleSignInAvailable = () =>
  Platform.OS === 'ios' && Constants.expoConfig?.extra?.appleSignIn !== false && AppleAuthentication.isAvailableAsync();

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
  // Forget the Google account too, so the next sign-in can choose another one.
  if (googleIds && Platform.OS !== 'web') {
    await import('@react-native-google-signin/google-signin').then(({ GoogleSignin }) => GoogleSignin.signOut()).catch(() => {});
  }
}
