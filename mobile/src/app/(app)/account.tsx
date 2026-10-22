import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MenuButton } from '@/components/MenuButton';
import { AppText, Button, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { signOut, useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { loadThemeChoice, setThemeChoice, type ThemeChoice } from '@/lib/theme-preference';
import { font, maxContentWidth, radius, space, useColors } from '@/theme';

interface Usage {
  billing: { plan?: string; credits_remaining?: number; credits_topup?: number; credits_used_this_month?: number; is_trial?: boolean } | null;
}

export default function Account() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletion, setDeletion] = useState<{ pending: boolean; deleteAfter?: string } | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>('system');
  useEffect(() => { loadThemeChoice().then(setTheme).catch(() => {}); }, []);
  const chooseTheme = (choice: ThemeChoice) => { setTheme(choice); void setThemeChoice(choice); };

  useFocusEffect(useCallback(() => {
    api<Usage>('/api/billing/usage').then(setUsage).catch(() => {});
    api<{ pending: boolean; deleteAfter?: string }>('/api/account/delete').then(setDeletion).catch(() => {});
  }, []));

  const b = usage?.billing;
  const credits = b ? (b.credits_remaining ?? 0) + (b.credits_topup ?? 0) : null;

  const requestDeletion = async () => {
    setBusy(true);
    try {
      const res = await api<{ message: string; deleteAfter?: string }>('/api/account/delete', { method: 'POST', body: { confirm } });
      setDeletion({ pending: true, deleteAfter: res.deleteAfter });
      setDeleting(false);
      setConfirm('');
      Alert.alert('Deletion scheduled', res.message);
    } catch (err) {
      Alert.alert('Could not request deletion', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const keepAccount = async () => {
    setBusy(true);
    try {
      const res = await api<{ message: string }>('/api/account/delete', { method: 'DELETE' });
      setDeletion({ pending: false });
      Alert.alert('Your account is staying', res.message);
    } catch (err) {
      Alert.alert('Could not cancel the deletion', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deleteOn = deletion?.deleteAfter
    ? new Date(deletion.deleteAfter).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={[styles.wrap, { paddingTop: insets.top + space.xs }]}>
      <View style={styles.titleRow}>
        <MenuButton />
        <AppText size="xxl" weight="800" accessibilityRole="header">Account</AppText>
      </View>

      <Card>
        <AppText size="sm" tone="muted">Signed in as</AppText>
        <AppText weight="600" selectable>{session?.user.email ?? '—'}</AppText>
      </Card>

      <Card>
        <AppText size="sm" tone="muted">Plan</AppText>
        <AppText weight="700" size="lg">{b?.plan ? b.plan[0].toUpperCase() + b.plan.slice(1) : '—'}{b?.is_trial ? ' (trial)' : ''}</AppText>
        <AppText size="sm" tone="muted" style={{ marginTop: space.sm }}>Credits left</AppText>
        <AppText weight="700" size="xxl">{credits === null ? '—' : credits.toLocaleString()}</AppText>
        {b?.credits_used_this_month ? <AppText size="sm" tone="secondary">{b.credits_used_this_month.toLocaleString()} used this month</AppText> : null}
        {Platform.OS !== 'web' ? <Button label="Buy credits" onPress={() => router.push('/buy-credits')} style={{ marginTop: space.sm, alignSelf: 'flex-start' }} /> : null}
      </Card>

      {Platform.OS !== 'web' ? (
        <Card>
          <AppText size="sm" tone="muted">Appearance</AppText>
          <View accessibilityRole="radiogroup" style={[styles.segment, { backgroundColor: c.bgSecondary, borderColor: c.border }]}>
            {(['system', 'light', 'dark'] as const).map(choice => (
              <Pressable
                key={choice}
                accessibilityRole="radio"
                accessibilityState={{ checked: theme === choice }}
                onPress={() => chooseTheme(choice)}
                style={[styles.segmentItem, theme === choice && { backgroundColor: c.card }]}
              >
                <AppText size="sm" weight="700" tone={theme === choice ? 'primary' : 'muted'}>
                  {choice === 'system' ? 'System' : choice === 'light' ? 'Light' : 'Dark'}
                </AppText>
              </Pressable>
            ))}
          </View>
          <AppText size="xs" tone="muted">System follows your phone’s light or dark setting.</AppText>
        </Card>
      ) : null}

      <Card>
        <Button label="Privacy policy" variant="ghost" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/privacy`)} />
        <Button label="Terms of service" variant="ghost" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/terms`)} />
        <Button label="Sign out" variant="ghost" onPress={() => signOut()} />
      </Card>

      {deletion?.pending ? (
        <Card tone="error">
          <AppText weight="700" tone="rose">Your account will be deleted{deleteOn ? ` on ${deleteOn}` : ''}</AppText>
          <AppText size="sm" tone="secondary">Nothing runs until then. Keep it, and your missions run and are scheduled as before.</AppText>
          <Button label="Keep my account" loading={busy} onPress={keepAccount} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}

      {deletion?.pending ? null : <Card>
        {deleting ? (
          <>
            <AppText weight="700" tone="rose">Delete your account</AppText>
            <AppText size="sm" tone="secondary">Your missions stop at once. After 7 days your account, missions, chats, files and app connections are deleted for good — you can keep it until then. Type DELETE to confirm.</AppText>
            <TextInput
              value={confirm} onChangeText={setConfirm} autoCapitalize="characters" placeholder="DELETE" placeholderTextColor={c.textMuted}
              style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.input }]} accessibilityLabel="Type DELETE to confirm"
            />
            <View style={styles.buttons}>
              <Button label="Delete my account" variant="danger" disabled={confirm !== 'DELETE'} loading={busy} onPress={requestDeletion} />
              <Button label="Cancel" variant="ghost" onPress={() => { setDeleting(false); setConfirm(''); }} />
            </View>
          </>
        ) : (
          <Button label="Delete account" variant="danger" onPress={() => setDeleting(true)} />
        )}
      </Card>}

      <AppText size="xs" tone="muted" style={{ textAlign: 'center' }}>Agentic Factor {Constants.expoConfig?.version ?? ''}</AppText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, gap: space.md, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingBottom: space.xxl * 2 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: font.md },
  buttons: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: -space.sm },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, padding: 3, gap: 3 },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
