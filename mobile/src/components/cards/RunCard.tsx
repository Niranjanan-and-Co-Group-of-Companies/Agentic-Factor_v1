// A run followed live: every agent's step, the approval it is waiting for (approve or reject right
// here), and the outcome. Polls while the run is going; stops when it ends or the app is in the background.

import type { ApprovalRecordPayload, LiveRunView } from '@contracts';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, TextInput, View } from 'react-native';

import { decideApproval } from '@/lib/actions';
import { api } from '@/lib/api';
import { headline, isFinished, stepView, timeLabel } from '@/lib/run-text';
import { font, radius, space, useColors } from '@/theme';

import { AppText, Badge, Button, Card } from '../ui';

export function RunCard({ missionId, runId, via, onRecord, onOpenMission }: {
  missionId: string;
  runId: string;
  via: 'mission_chat' | 'command_center';
  onRecord?: (r: ApprovalRecordPayload) => void;
  onOpenMission?: () => void;
}) {
  const c = useColors();
  const [view, setView] = useState<LiveRunView | null>(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const v = await api<LiveRunView>(`/api/missions/${missionId}/live?runId=${encodeURIComponent(runId)}`);
        if (stopped) return;
        setView(v);
        setSkew(Date.parse(v.serverTime) - Date.now());
        setError(null);
        if (isFinished(v.run?.status)) return;
        timer.current = setTimeout(poll, v.run?.status === 'paused' ? 5000 : 2500);
      } catch (err) {
        if (stopped) return;
        setError((err as Error).message);
        timer.current = setTimeout(poll, 6000);
      }
    };
    poll();
    // Background: stop polling; back in front: check right away.
    const sub = AppState.addEventListener('change', state => {
      if (timer.current) clearTimeout(timer.current);
      if (state === 'active') poll();
    });
    return () => { stopped = true; sub.remove(); if (timer.current) clearTimeout(timer.current); };
  }, [missionId, runId]);

  // The timer ticks while the run is going.
  useEffect(() => {
    if (!view?.run || isFinished(view.run.status)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [view?.run]);

  if (!view?.run) {
    return (
      <Card tone="pending">
        <View style={styles.row}>
          <ActivityIndicator color={c.textMuted} />
          <AppText tone="secondary">{error ? 'Reconnecting to the run…' : 'Starting the run…'}</AppText>
        </View>
      </Card>
    );
  }

  const run = view.run;
  const rehearsal = run.mode === 'rehearsal';
  const t = now + skew;
  return (
    <Card tone={run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'error' : 'pending'}>
      <View style={styles.row}>
        <Badge label={rehearsal ? 'Rehearsal' : 'Live'} tone={rehearsal ? 'amber' : 'emerald'} />
        <AppText size="xs" tone="muted" style={{ marginLeft: 'auto' }}>{timeLabel(view, t)}</AppText>
      </View>
      <AppText weight="700" accessibilityRole="header">{view.mission.title}</AppText>
      <AppText tone={run.status === 'failed' ? 'rose' : 'secondary'} accessibilityLiveRegion="polite">{headline(view, t)}</AppText>

      <View style={{ gap: space.sm, marginTop: space.xs }}>
        {view.agents.map((a, i) => {
          const s = stepView(a, rehearsal, t);
          return (
            <View key={a.id} style={styles.agent} accessible accessibilityLabel={`Step ${i + 1}, ${a.role}: ${s.chip}${s.note ? `. ${s.note}` : ''}`}>
              <View style={[styles.dot, { backgroundColor: s.tone === 'muted' ? c.border : c[s.tone] }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText weight="600">{a.role}</AppText>
                {s.note && a.step !== 'waiting' ? <AppText size="sm" tone={s.tone === 'rose' ? 'rose' : 'muted'}>{s.note}</AppText> : null}
              </View>
              <AppText size="xs" weight="700" tone={s.tone === 'muted' ? 'muted' : s.tone}>{s.chip}</AppText>
            </View>
          );
        })}
      </View>

      {view.approval && !isFinished(run.status) ? (
        <ApprovalPanel view={view} missionId={missionId} via={via} onRecord={onRecord} />
      ) : null}

      {run.status === 'completed' && !rehearsal && run.summary ? <AppText tone="secondary">{run.summary}</AppText> : null}
      {run.status === 'failed' && run.error ? <AppText tone="rose">{run.error}</AppText> : null}
      {onOpenMission ? <Button label="Open mission" variant="ghost" onPress={onOpenMission} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card>
  );
}

function ApprovalPanel({ view, missionId, via, onRecord }: {
  view: LiveRunView;
  missionId: string;
  via: 'mission_chat' | 'command_center';
  onRecord?: (r: ApprovalRecordPayload) => void;
}) {
  const c = useColors();
  const approval = view.approval!;
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fullPreview, setFullPreview] = useState(false);
  const rehearsal = approval.kind === 'rehearsal';

  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(decision);
    setError(null);
    try {
      const record = await decideApproval({ actionId: approval.id, decision, missionId, reason: reason.trim() || undefined, via });
      if (Platform.OS !== 'web') Haptics.notificationAsync(decision === 'approved' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
      if (record) onRecord?.(record);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.approval, { backgroundColor: c.amberBg, borderColor: c.amber }]}>
      <AppText weight="700">{rehearsal ? `Check what “${approval.agentRole}” would do` : `“${approval.agentRole}” wants to:`}</AppText>
      {approval.actions.map(a => <AppText key={a} tone="secondary">• {a}</AppText>)}
      {approval.preview ? (
        <View style={[styles.preview, { backgroundColor: c.card, borderColor: c.border }]}>
          <AppText size="sm" selectable numberOfLines={fullPreview ? undefined : 12}>{approval.preview}</AppText>
          <AppText size="sm" tone="accent" weight="600" accessibilityRole="button" onPress={() => setFullPreview(v => !v)}>
            {fullPreview ? 'Show less' : 'Show the full preview'}
          </AppText>
        </View>
      ) : null}
      {rejecting ? (
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Why? (optional — the agent sees this)"
          placeholderTextColor={c.textMuted}
          style={[styles.reason, { color: c.text, borderColor: c.border, backgroundColor: c.input }]}
          multiline
          accessibilityLabel="Reason for rejecting"
        />
      ) : null}
      {error ? <AppText tone="rose" size="sm">{error}</AppText> : null}
      <View style={styles.buttons}>
        {rejecting ? (
          <>
            <Button label="Reject" variant="danger" loading={busy === 'rejected'} disabled={!!busy} onPress={() => decide('rejected')} />
            <Button label="Back" variant="ghost" disabled={!!busy} onPress={() => setRejecting(false)} />
          </>
        ) : (
          <>
            <Button label={rehearsal ? 'Looks right' : 'Approve'} loading={busy === 'approved'} disabled={!!busy} onPress={() => decide('approved')} />
            <Button label="Reject" variant="ghost" disabled={!!busy} onPress={() => setRejecting(true)} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  agent: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  approval: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm, marginTop: space.xs },
  preview: { borderWidth: 1, borderRadius: radius.sm, padding: space.sm, gap: space.xs },
  reason: { borderWidth: 1, borderRadius: radius.sm, padding: space.sm, minHeight: 60, fontSize: font.md },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
