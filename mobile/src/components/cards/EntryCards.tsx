// Entries saved into a chat: a button's result, an approval decision, and where a conversation moved in
// from Command Center. Kept with the chat, so they come back after a reload.

import type { ActionResultEntry, ApprovalRecordPayload, ResultKind, ThreadNote } from '@contracts';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { space, useColors } from '@/theme';

import { AppText, Button, Card } from '../ui';

const DONE: Record<ResultKind, string> = {
  run: 'Run started', schedule: 'Schedule set', unschedule: 'Schedule removed', pause: 'Mission paused',
  resume: 'Mission resumed', go_live: 'Mission is live', connect: 'Connected', webhook: 'Webhook ready',
  revert: 'Reverted', update: 'Mission updated',
};
const FAILED: Record<ResultKind, string> = {
  run: 'Couldn’t start the run', schedule: 'Couldn’t set the schedule', unschedule: 'Couldn’t remove the schedule',
  pause: 'Couldn’t pause the mission', resume: 'Couldn’t resume the mission', go_live: 'Couldn’t switch to live',
  connect: 'Couldn’t connect', webhook: 'Couldn’t create the webhook', revert: 'Couldn’t revert', update: 'Couldn’t update the mission',
};
const PENDING: Record<ResultKind, string> = {
  run: 'Starting the run', schedule: 'Setting the schedule', unschedule: 'Removing the schedule', pause: 'Pausing the mission',
  resume: 'Resuming the mission', go_live: 'Switching to live', connect: 'Connecting', webhook: 'Creating the webhook',
  revert: 'Reverting', update: 'Updating the mission',
};

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

export function PendingCard({ kind, label }: { kind: ResultKind; label: string }) {
  const c = useColors();
  return (
    <Card tone="pending">
      <View style={styles.row} accessibilityLiveRegion="polite">
        <ActivityIndicator color={c.textMuted} />
        <AppText weight="600">{PENDING[kind]}…</AppText>
        <AppText tone="secondary" style={{ flexShrink: 1 }}>{label}</AppText>
      </View>
    </Card>
  );
}

export function ResultCard({ entry, onRetry }: { entry: ActionResultEntry; onRetry?: () => void }) {
  return (
    <Card tone={entry.ok ? 'ok' : 'error'}>
      <View style={styles.row}>
        <AppText weight="700" tone={entry.ok ? 'emerald' : 'rose'}>{entry.ok ? '✓' : '!'}</AppText>
        <AppText weight="600" style={{ flex: 1 }}>{(entry.ok ? DONE : FAILED)[entry.kind]} · <AppText tone="secondary">{entry.label}</AppText></AppText>
      </View>
      {entry.detail ? <AppText size="sm" tone="secondary">{entry.detail}</AppText> : null}
      {!entry.ok && entry.error ? <AppText size="sm" tone="rose">{entry.error}</AppText> : null}
      <AppText size="xs" tone="muted">{[when(entry.at), entry.by ? `by ${entry.by}` : ''].filter(Boolean).join(' · ')}</AppText>
      {!entry.ok && onRetry ? <Button label="Try again" variant="ghost" onPress={onRetry} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card>
  );
}

export function ApprovalRecordCard({ record }: { record: ApprovalRecordPayload }) {
  const approved = record.decision === 'approved';
  return (
    <Card tone={approved ? 'ok' : 'error'}>
      <AppText weight="600">
        {approved ? (record.kind === 'rehearsal' ? 'Preview approved' : 'Approved') : 'Rejected'} · <AppText tone="secondary">{record.agentRole}</AppText>
      </AppText>
      {record.actions.map(a => <AppText key={a} size="sm" tone="secondary">• {a}</AppText>)}
      {record.reason ? <AppText size="sm">“{record.reason}”</AppText> : null}
      <AppText size="xs" tone="muted">{[when(record.decidedAt), record.decidedBy ? `by ${record.decidedBy}` : ''].filter(Boolean).join(' · ')}</AppText>
    </Card>
  );
}

export function ThreadNoteRow({ note }: { note: ThreadNote }) {
  const c = useColors();
  return (
    <View style={styles.note} accessibilityRole="text">
      <View style={[styles.line, { backgroundColor: c.border }]} />
      <AppText size="xs" tone="muted" weight="600">
        {note.kind === 'started' ? `Started in Command Center · ${when(note.at)}` : `Mission created · ${when(note.at)} · continue here`}
      </AppText>
      <View style={[styles.line, { backgroundColor: c.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.xs },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});
