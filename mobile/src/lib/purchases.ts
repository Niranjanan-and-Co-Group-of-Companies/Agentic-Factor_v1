// Buying credits and plans in the app — App Store and Google Play, through RevenueCat. The RevenueCat
// user is the Supabase user, so the website's webhook (/api/revenuecat/webhook) knows whose account a
// purchase is for. Store builds use the stores' keys; development builds may use the Test Store key,
// whose purchases are free (the server counts them only for test accounts). In Expo Go the SDK only
// simulates purchases.

import { Platform } from 'react-native';
import Purchases, { PURCHASES_ERROR_CODE, type PurchasesError, type PurchasesPackage } from 'react-native-purchases';

const native = Platform.OS === 'ios' || Platform.OS === 'android';
const storeKey = Platform.select({ ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY, android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY });
const testKey = process.env.EXPO_PUBLIC_REVENUECAT_TEST_KEY;
const apiKey = native ? (storeKey || (__DEV__ ? testKey : undefined)) : undefined;

/** Whether this build can sell anything (not on the web, and only with a key). */
export const purchasesAvailable = !!apiKey;

/** The store's name, for "manage it in …" text. */
export const storeName = Platform.OS === 'android' ? 'Google Play' : 'the App Store';

let signedInAs: string | null = null;

/** Connects RevenueCat as this user, so what they buy lands on their account. */
async function connect(userId: string): Promise<void> {
  if (!apiKey) throw new Error('Buying in the app is not available in this version.');
  if (!(await Purchases.isConfigured())) {
    Purchases.configure({ apiKey, appUserID: userId });
    signedInAs = userId;
  } else if (signedInAs !== userId) {
    await Purchases.logIn(userId);
    signedInAs = userId;
  }
}

/** The store's packages for sale, by product id (Google Play subscriptions without their ":base plan"). */
export async function loadPackages(userId: string): Promise<Map<string, PurchasesPackage>> {
  await connect(userId);
  const offerings = await Purchases.getOfferings();
  const offered = offerings.current ? [offerings.current] : Object.values(offerings.all);
  const byProduct = new Map<string, PurchasesPackage>();
  for (const pkg of offered.flatMap(o => o.availablePackages)) {
    const id = pkg.product.identifier.split(':')[0];
    if (!byProduct.has(id)) byProduct.set(id, pkg);
  }
  return byProduct;
}

export type PurchaseResult = 'bought' | 'cancelled' | 'pending';

/** Buys a package. Cancelling is not an error; a payment waiting for approval (Ask to Buy) is "pending". */
export async function buy(userId: string, pkg: PurchasesPackage): Promise<PurchaseResult> {
  await connect(userId);
  try {
    await Purchases.purchasePackage(pkg);
    return 'bought';
  } catch (err) {
    const code = (err as PurchasesError).code;
    if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
    if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return 'pending';
    throw err;
  }
}

/** Restores the plan on a new phone or after reinstalling (Apple requires the option). */
export async function restore(userId: string): Promise<void> {
  await connect(userId);
  await Purchases.restorePurchases();
}

/** Opens the store's own screen for changing or cancelling the subscription. */
export async function manageSubscription(userId: string): Promise<void> {
  await connect(userId);
  await Purchases.showManageSubscriptions();
}
