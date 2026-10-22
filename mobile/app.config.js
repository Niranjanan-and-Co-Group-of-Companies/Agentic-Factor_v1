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

module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'personal') return config;
  return {
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
  };
};
