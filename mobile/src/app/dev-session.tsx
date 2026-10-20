// Development only: signs the app in with an existing session (agenticfactor://dev-session?access=…&refresh=…),
// so the app can be tested on emulators without typing a password. Production builds ignore it.

import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { supabase } from '@/lib/supabase';

export default function DevSession() {
  const { access, refresh } = useLocalSearchParams<{ access?: string; refresh?: string }>();
  const [done, setDone] = useState(!__DEV__);
  useEffect(() => {
    if (!__DEV__ || !access || !refresh) return;
    supabase.auth.setSession({ access_token: String(access), refresh_token: String(refresh) }).finally(() => setDone(true));
  }, [access, refresh]);
  if (done || !access || !refresh) return <Redirect href="/" />;
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
}
