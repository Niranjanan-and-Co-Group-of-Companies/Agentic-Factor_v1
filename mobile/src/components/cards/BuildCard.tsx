// A mission being built: live progress with each agent's code, the architect's question if it has one,
// then the new mission (with what it cost) — or the real reason it failed, and Try again.

import type { BlueprintStatus, CommandAction } from '@contracts';
import { useEffect, useEffectEvent, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';

import { connectApp, retryBuild } from '@/lib/actions';
import { api } from '@/lib/api';
import { space, useColors } from '@/theme';

import { AppText, Button, Card } from '../ui';

const FINAL = new Set(['completed', 'failed', 'discovery']);

export function BuildCard({ jobId, onJobChange, onCreated, onQuestion }: {
  jobId: string;
  /** Try again started a new job for the same request. */
  onJobChange: (jobId: string) => void;
  onCreated: (action: CommandAction) => void;
  onQuestion: (question: string) => void;
}) {
  const c = useColors();
  const [status, setStatus] = useState<BlueprintStatus>({ status: 'pending', step: 'Queued…' });
  const [retrying, setRetrying] = useState(false);
  // The parent's callbacks without restarting the polling when they change.
  const created = useEffectEvent((a: CommandAction) => onCreated(a));
  const asked = useEffectEvent((q: string) => onQuestion(q));

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const s = await api<BlueprintStatus>(`/api/blueprint-status?jobId=${encodeURIComponent(jobId)}`);
        if (stopped) return;
        setStatus(s);
        if (s.status === 'completed' && s.missionId) {
          created({ type: 'mission_created', jobId, ...s, missionId: s.missionId });
          return;
        }
        if (s.status === 'discovery' && s.question) { asked(s.question); return; }
        if (s.status && FINAL.has(s.status)) return;
      } catch { /* try again shortly */ }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    poll();
    const sub = AppState.addEventListener('change', st => { if (timer) clearTimeout(timer); if (st === 'active') poll(); });
    return () => { stopped = true; sub.remove(); if (timer) clearTimeout(timer); };
  }, [jobId]);

  if (status.status === 'failed') {
    return (
      <Card tone="error">
        <AppText weight="700" tone="rose">Could not create the mission</AppText>
        {status.error ? <AppText tone="secondary">{status.error}</AppText> : null}
        {status.credits ? <AppText size="sm" tone="muted">Charged {status.credits} credits, at the reduced rate for failed builds.</AppText> : null}
        <Button
          label="Try again" variant="ghost" loading={retrying} style={{ alignSelf: 'flex-start' }}
          onPress={async () => {
            setRetrying(true);
            try { onJobChange(await retryBuild(jobId)); } catch (err) { setStatus(s => ({ ...s, error: (err as Error).message })); }
            setRetrying(false);
          }}
        />
      </Card>
    );
  }

  return (
    <Card tone="pending">
      <View style={styles.row}>
        <ActivityIndicator color={c.accent} />
        <View style={{ flex: 1 }}>
          <AppText weight="700">Building your mission</AppText>
          <AppText size="sm" tone="secondary" accessibilityLiveRegion="polite">{status.step ?? 'Working…'}</AppText>
        </View>
      </View>
      {status.progress?.roles.length ? (
        <View style={{ gap: 4 }}>
          {status.progress.roles.map(role => {
            const ready = status.progress!.ready.includes(role);
            return (
              <View key={role} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: ready ? c.emerald : c.accent }]} />
                <AppText size="sm" tone={ready ? 'muted' : 'primary'}>{ready ? `Code ready · ${role}` : `Writing code · ${role}`}</AppText>
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

/** The new mission: its agents, the apps to connect, and where to go next. */
export function MissionCreatedCard({ action, onOpen, onRun }: { action: CommandAction; onOpen: () => void; onRun: () => void }) {
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [connecting, setConnecting] = useState<string | null>(null);
  const missing = (action.requiredConnectors ?? []).filter(r => !r.connected && !connected[r.service]);
  return (
    <Card tone="ok">
      <AppText weight="700">Mission ready: {action.missionTitle}</AppText>
      {action.credits ? <AppText size="sm" tone="muted">Built for {action.credits} credits</AppText> : null}
      <View style={{ gap: 4 }}>
        {(action.agents ?? []).map((a, i) => (
          <AppText key={`${a.name}-${i}`} size="sm" tone="secondary">{i + 1}. {a.name}{a.tool ? ` · ${a.tool}` : ''}</AppText>
        ))}
      </View>
      {missing.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <AppText size="sm" tone="amber">Connect these before running it:</AppText>
          {missing.map(r => (
            <Button
              key={r.service} label={`Connect ${r.service}`} variant="ghost" loading={connecting === r.service}
              onPress={async () => {
                setConnecting(r.service);
                const res = await connectApp(r.service);
                if (res?.ok) setConnected(prev => ({ ...prev, [r.service]: true }));
                setConnecting(null);
              }}
            />
          ))}
        </View>
      ) : null}
      {action.movedToChat ? <AppText size="sm" tone="accent">This conversation continues in the mission chat →</AppText> : null}
      <View style={styles.buttons}>
        <Button label="Open mission" onPress={onOpen} />
        <Button label="Run" variant="ghost" disabled={missing.length > 0} onPress={onRun} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  buttons: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
});
