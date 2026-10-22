// Missions with a run going now, or waiting on the customer's approval — for the sidebar's count and the
// menu button's dot. Checked every 15 seconds while the app is open.

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { api } from './api';

export type RunState = 'running' | 'approval';

export function useActiveRuns(): Record<string, RunState> {
  const [active, setActive] = useState<Record<string, RunState>>({});
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      if (timer) clearTimeout(timer);
      try {
        const res = await api<{ active?: Record<string, RunState> }>('/api/runs/active');
        if (!stopped) setActive(res.active ?? {});
      } catch { /* keep the last answer */ }
      if (!stopped && AppState.currentState === 'active') timer = setTimeout(load, 15_000);
    };
    void load();
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { stopped = true; if (timer) clearTimeout(timer); sub.remove(); };
  }, []);
  return active;
}
