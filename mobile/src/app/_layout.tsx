import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/lib/auth';
import { useColors } from '@/theme';

SplashScreen.preventAutoHideAsync();

function Navigator() {
  const { session, loading } = useAuth();
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);
  if (loading) return null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = useColors();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, border: c.border, primary: c.accent } };
  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <AuthProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <Navigator />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
