// Buy credits: credit packs (never expire) and monthly plans, paid through the App Store or Google Play.
// The store's webhook adds the credits on the server; after paying, this waits until they show up.

import type { StoreBillingStatus, StoreProductInfo } from '@contracts';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { buy, loadPackages, manageSubscription, purchasesAvailable, restore, storeName } from '@/lib/purchases';
import { maxContentWidth, space, useColors } from '@/theme';

const fetchStatus = () => api<StoreBillingStatus>('/api/billing/store');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function BuyCredits() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const userId = useAuth().session?.user.id ?? '';
  const [status, setStatus] = useState<StoreBillingStatus | null>(null);
  const [packages, setPackages] = useState<Map<string, PurchasesPackage> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus().then(setStatus).catch(err => setLoadError((err as Error).message));
    if (purchasesAvailable && userId) {
      loadPackages(userId).then(setPackages).catch(err => setLoadError((err as Error).message));
    }
  }, [userId]);

  /** After paying: the store tells the server, which adds the credits — usually within seconds. */
  const waitForCredits = async (before: StoreBillingStatus) => {
    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      const now = await fetchStatus().catch(() => null);
      if (!now) continue;
      if (now.payments > before.payments) {
        setStatus(now);
        return true;
      }
    }
    return false;
  };

  const purchase = async (product: StoreProductInfo, pkg: PurchasesPackage) => {
    if (!status) return;
    setBusy(product.id);
    try {
      const result = await buy(userId, pkg);
      if (result === 'cancelled') return;
      if (result === 'pending') {
        Alert.alert('Waiting for approval', 'Your credits are added as soon as the payment is approved.');
        return;
      }
      setBusy(`${product.id}:adding`);
      const landed = await waitForCredits(status);
      Alert.alert(
        landed ? (product.kind === 'pack' ? 'Credits added' : `${product.name} plan active`) : 'Payment received',
        landed
          ? (product.kind === 'pack' ? `${product.credits.toLocaleString()} credits are on your account.` : `${product.credits.toLocaleString()} credits a month, renewing monthly.`)
          : 'Your credits will show up on your account in a minute.',
      );
    } catch (err) {
      Alert.alert('The purchase did not go through', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restorePurchases = async () => {
    setBusy('restore');
    try {
      await restore(userId);
      await sleep(3000);
      setStatus(await fetchStatus());
      Alert.alert('Purchases restored', 'Any plan bought with this store account is on your account again.');
    } catch (err) {
      Alert.alert('Could not restore purchases', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const products = status?.products ?? [];
  const packs = products.filter(p => p.kind === 'pack');
  const plans = products.filter(p => p.kind === 'plan');
  const storePlan = status?.billedBy && status.billedBy !== 'website' && status.billedBy !== 'other';
  const planName = status?.plan ? status.plan[0].toUpperCase() + status.plan.slice(1) : '';

  const row = (p: StoreProductInfo) => {
    const pkg = packages?.get(p.id);
    const adding = busy === `${p.id}:adding`;
    return (
      <Card key={p.id}>
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText weight="700">{p.kind === 'pack' ? `${p.credits.toLocaleString()} credits` : `${p.name} — ${p.credits.toLocaleString()} credits a month`}</AppText>
            <AppText size="sm" tone="secondary">
              {p.kind === 'pack' ? `${p.name} · never expire` : `${p.maxActiveMissions} active missions · renews monthly`}
            </AppText>
          </View>
          <Button
            label={adding ? 'Adding…' : pkg ? `${pkg.product.priceString}${p.kind === 'plan' ? '/mo' : ''}` : '—'}
            loading={busy === p.id}
            disabled={!pkg || (busy !== null && busy !== p.id)}
            onPress={() => pkg && purchase(p, pkg)}
            accessibilityHint={p.kind === 'pack' ? `Buys ${p.credits} credits` : `Subscribes to the ${p.name} plan`}
          />
        </View>
      </Card>
    );
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={[styles.wrap, { paddingTop: space.lg + (Platform.OS === 'ios' ? 0 : insets.top) }]}>
      <View style={styles.header}>
        <AppText size="xxl" weight="800" accessibilityRole="header">Buy credits</AppText>
        <Button label="Done" variant="ghost" onPress={() => router.back()} />
      </View>

      <Card>
        <AppText size="sm" tone="muted">Credits left</AppText>
        <AppText weight="700" size="xxl">{status ? status.credits.toLocaleString() : '—'}</AppText>
        {status ? <AppText size="sm" tone="secondary">{planName} plan{status.isTrial ? ' (trial)' : ''}</AppText> : null}
      </Card>

      {!purchasesAvailable ? (
        <Card><AppText tone="secondary">Buying in the app isn&apos;t available in this version.</AppText></Card>
      ) : loadError ? (
        <Card tone="error"><AppText tone="secondary">Could not load what&apos;s for sale: {loadError}</AppText></Card>
      ) : !status || !packages ? (
        <ActivityIndicator style={{ marginTop: space.xl }} />
      ) : (
        <>
          <AppText weight="700" size="lg" accessibilityRole="header">Credit packs</AppText>
          {packs.map(row)}

          <AppText weight="700" size="lg" accessibilityRole="header" style={{ marginTop: space.md }}>Monthly plans</AppText>
          {status.billedBy === 'website' || status.billedBy === 'other' ? (
            <Card><AppText tone="secondary">Your {planName} plan is {status.billedBy === 'website' ? 'billed through the website' : 'arranged with our team'}.</AppText></Card>
          ) : storePlan ? (
            <Card>
              <AppText weight="700">{planName} plan{status.billingStatus === 'cancellation_pending' ? ' — ends' : ' — renews'}{status.periodEnd ? ` on ${new Date(status.periodEnd).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` : ''}</AppText>
              <AppText size="sm" tone="secondary">Change or cancel it in {storeName}.</AppText>
              <Button label="Manage subscription" variant="ghost" loading={busy === 'manage'} style={{ alignSelf: 'flex-start' }}
                onPress={() => { setBusy('manage'); manageSubscription(userId).catch(err => Alert.alert('Could not open it', (err as Error).message)).finally(() => setBusy(null)); }} />
            </Card>
          ) : (
            plans.map(row)
          )}

          <Button label="Restore purchases" variant="ghost" loading={busy === 'restore'} disabled={busy !== null && busy !== 'restore'} onPress={restorePurchases} />
          <AppText size="xs" tone="muted">
            Plans renew every month and are charged to your {storeName} account until you cancel, at least 24 hours before the renewal date, in your {storeName} settings. Credit packs never expire.
          </AppText>
          <View style={styles.links}>
            <Button label="Terms of service" variant="ghost" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/terms`)} />
            <Button label="Privacy policy" variant="ghost" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/privacy`)} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, gap: space.md, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingBottom: space.xxl * 2 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
