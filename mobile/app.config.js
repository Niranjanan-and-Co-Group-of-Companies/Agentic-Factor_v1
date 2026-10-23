// Build variants on top of app.json.
//
// APP_VARIANT=personal — a test copy for a free Apple account (Xcode "Personal Team"): its own bundle id,
// so io.agenticfactor.app stays free for the paid developer account, and no Sign in with Apple, which
// free accounts cannot use (the sign-in screen hides the button). Installs from Xcode last 7 days.
const { withEntitlementsPlist } = require('expo/config-plugins');

// Expo adds the Sign in with Apple entitlement whenever expo-apple-authentication is installed; app
// plugins' changes are applied after Expo's own, so this removes it again.
const withoutAppleSignIn = config => withEntitlementsPlist(config, c => {
  delete c.modResults['com.apple.developer.applesignin'];
  return c;
});

// Google sign-in on the phone's own Google sheet, once this build has its Google OAuth client IDs (all
// public): GOOGLE_WEB_CLIENT_ID — the client Supabase's Google sign-in uses — and the iOS client made for
// this build's bundle id (GOOGLE_IOS_CLIENT_ID, or GOOGLE_IOS_TEST_CLIENT_ID for the test copy). Android
// needs no id here: its client is matched by package name and signing key. Without them, Google sign-in
// stays in the browser.
const withGoogleSignIn = (config, iosClientId) => {
  const webClientId = process.env.GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) return config;
  const iosUrlScheme = iosClientId && `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
  return {
    ...config,
    plugins: iosUrlScheme ? [...config.plugins, ['@react-native-google-signin/google-signin', { iosUrlScheme }]] : config.plugins,
    extra: { ...config.extra, googleSignIn: { webClientId, ...(iosClientId ? { iosClientId } : {}) } },
  };
};

module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'personal') return withGoogleSignIn(config, process.env.GOOGLE_IOS_CLIENT_ID);
  return withGoogleSignIn({
    ...config,
    name: 'Agentic Factor (Test)',
    ios: {
      ...config.ios,
      bundleIdentifier: 'io.agenticfactor.app.test',
      usesAppleSignIn: false,
      ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
    },
    plugins: [...config.plugins.filter(p => (Array.isArray(p) ? p[0] : p) !== 'expo-apple-authentication'), withoutAppleSignIn],
    extra: { ...config.extra, appleSignIn: false },
  }, process.env.GOOGLE_IOS_TEST_CLIENT_ID);
};
