import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, useColorScheme, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LogoMark } from '@/components/Logo';
import { AppText, Button } from '@/components/ui';
import { appleSignInAvailable, signInWithApple, signInWithEmail, signInWithGoogle, signUpWithEmail } from '@/lib/auth';
import { font, radius, space, useColors } from '@/theme';

export default function SignIn() {
  const c = useColors();
  const dark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apple, setApple] = useState(false);

  useEffect(() => { Promise.resolve(appleSignInAvailable()).then(v => setApple(!!v)).catch(() => {}); }, []);

  const run = async (kind: 'email' | 'google' | 'apple', work: () => Promise<void>) => {
    setBusy(kind); setError(null); setNotice(null);
    try { await work(); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  };

  const submitEmail = () => run('email', async () => {
    if (!email.trim() || !password) throw new Error('Enter your email and password.');
    if (mode === 'signin') return signInWithEmail(email, password);
    if (password.length < 6) throw new Error('Use at least 6 characters for the password.');
    const result = await signUpWithEmail(email, password);
    if (result === 'exists') throw new Error('An account with this email already exists. Sign in instead.');
    setNotice('Account created. Open the confirmation link we emailed you, then sign in here.');
    setMode('signin');
  });

  const inputStyle = [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.input }];
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          <LogoMark height={44} />
          <AppText size="xxl" weight="800" accessibilityRole="header">Agentic Factor</AppText>
          <AppText tone="secondary">Your AI chief of staff. Ask for anything — it gets it done with your apps, and runs the things you need regularly by itself.</AppText>

          <View style={{ gap: space.sm, marginTop: space.lg }}>
            {apple ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={radius.md}
                style={{ height: 48 }}
                onPress={() => run('apple', signInWithApple)}
              />
            ) : null}
            <Button label="Continue with Google" variant="ghost" loading={busy === 'google'} disabled={!!busy} onPress={() => run('google', signInWithGoogle)} />
          </View>

          <View style={styles.divider}>
            <View style={[styles.line, { backgroundColor: c.border }]} />
            <AppText size="xs" tone="muted">or with email</AppText>
            <View style={[styles.line, { backgroundColor: c.border }]} />
          </View>

          <TextInput
            value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={c.textMuted}
            autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress"
            style={inputStyle} accessibilityLabel="Email"
          />
          <TextInput
            value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={c.textMuted}
            secureTextEntry autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            textContentType={mode === 'signin' ? 'password' : 'newPassword'}
            style={inputStyle} accessibilityLabel="Password" onSubmitEditing={submitEmail} returnKeyType="go"
          />
          {error ? <AppText tone="rose" accessibilityLiveRegion="assertive">{error}</AppText> : null}
          {notice ? <AppText tone="emerald" accessibilityLiveRegion="polite">{notice}</AppText> : null}
          <Button label={mode === 'signin' ? 'Sign in' : 'Create account'} loading={busy === 'email'} disabled={!!busy} onPress={submitEmail} />
          <Button
            label={mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
            variant="ghost" disabled={!!busy}
            onPress={() => { setMode(m => (m === 'signin' ? 'signup' : 'signin')); setError(null); }}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, paddingHorizontal: space.xl, justifyContent: 'center' },
  inner: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: space.md },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: font.md },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.sm },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});
