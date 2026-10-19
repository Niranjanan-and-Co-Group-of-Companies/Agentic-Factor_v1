// A mission's own chat: talk to its agent, run it, approve what it prepares, schedule or change it.

import type { ActionResultEntry, ApprovalRecordPayload, ChatAction, LiveRunView, MissionAction, ResultKind, ThreadNote } from '@contracts';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';

import { ApprovalRecordCard, PendingCard, ResultCard, ThreadNoteRow } from '@/components/cards/EntryCards';
import { RunCard } from '@/components/cards/RunCard';
import { UpdateCard } from '@/components/cards/UpdateCard';
import { ChatView } from '@/components/chat/ChatView';
import { AppText, Button, Card } from '@/components/ui';
import { connectApp, createWebhook, goLive, markUsed, patchMission, revertVersion, saveResult, startRun, updateMission, type Outcome } from '@/lib/actions';
import { api } from '@/lib/api';
import { newKey, type ChatItem } from '@/lib/chat';
import { useChat } from '@/lib/useChat';
import { space } from '@/theme';

const ONE_SHOT = new Set(['run_now', 'resume_run', 'go_live', 'schedule', 'run_selective', 'revert_version', 'update_mission', 'webhook']);

export default function MissionChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const missionId = String(id);
  const headerHeight = useHeaderHeight();
  const [mission, setMission] = useState<LiveRunView['mission'] | null>(null);
  const chat = useChat({ endpoint: `/api/missions/${missionId}/chat`, sessionsPath: `/api/missions/${missionId}/chat/sessions`, firstLoadAlert: true });
  const { setItems, append } = chat;

  const refreshMission = useCallback(() => {
    api<LiveRunView>(`/api/missions/${missionId}/live`).then(v => setMission(v.mission)).catch(() => {});
  }, [missionId]);
  useEffect(() => { refreshMission(); }, [refreshMission]);

  const patchItem = useCallback((key: string, patch: Partial<ChatItem>) => {
    setItems(prev => prev.map(i => (i.key === key ? { ...i, ...patch } : i)));
  }, [setItems]);

  const record = useCallback((r: ApprovalRecordPayload) => {
    append({ key: newKey(), role: 'assistant', content: '', action: r as unknown as ChatAction, applied: true });
    refreshMission();
  }, [append, refreshMission]);

  const inChat = useCallback(async (kind: ResultKind, label: string, work: () => Promise<Outcome>, action?: ChatAction) => {
    const key = newKey();
    append({ key, role: 'assistant', content: '', pending: { kind, label } });
    const outcome = await work().catch(err => ({ ok: false, error: (err as Error).message }) as Outcome);
    const entry = await saveResult(
      { kind, label, missionId, missionTitle: mission?.title, via: 'mission_chat', action: action as Record<string, unknown> | undefined, ...outcome },
      { missionId },
    );
    patchItem(key, { pending: undefined, action: entry as unknown as ChatAction, applied: true });
    refreshMission();
  }, [append, mission?.title, missionId, patchItem, refreshMission]);

  const run = useCallback(async (label: string, body?: Record<string, unknown>, action?: ChatAction) => {
    try {
      const runId = await startRun(missionId, mission?.status, body);
      append({ key: newKey(), role: 'assistant', content: '', run: { missionId, runId } });
      refreshMission();
    } catch (err) {
      await inChat('run', label, async () => ({ ok: false, error: (err as Error).message }), action);
    }
  }, [append, inChat, mission?.status, missionId, refreshMission]);

  const apply = useCallback(async (action: MissionAction, item?: ChatItem) => {
    if (item && ONE_SHOT.has(action.type)) { patchItem(item.key, { applied: true }); markUsed(item.id); }
    switch (action.type) {
      case 'run_now': return run(action.label ?? 'Run this mission', undefined, action);
      case 'resume_run': return run(action.label ?? 'Resume', { mode: 'resume' }, action);
      case 'run_selective': return run(action.label ?? 'Run selected agents', { selectedAgents: action.agents, executionMode: action.executionMode ?? 'sequential' }, action);
      case 'go_live': return inChat('go_live', 'Live runs', () => goLive(missionId), action);
      case 'schedule': return inChat('schedule', action.label ?? action.cron ?? 'Schedule', () => patchMission(missionId, { action: 'schedule', scheduleConfig: { cron: action.cron, timezone: action.timezone ?? 'Asia/Kolkata' } }, action.label ?? 'Scheduled'), action);
      case 'revert_version': return inChat('revert', action.label ?? `Version ${action.versionNumber}`, () => revertVersion(missionId, Number(action.versionNumber)), action);
      case 'suggest_connector': {
        if (!action.provider) return;
        const outcome = await connectApp(action.provider);
        if (outcome) await inChat('connect', action.provider, async () => outcome, action);
        return;
      }
      case 'webhook': return inChat('webhook', 'Trigger URL', async () => {
        const hook = await createWebhook(missionId);
        const details = `POST ${hook.triggerUrl}\nHeader: x-webhook-secret: ${hook.secret}\nBody: any JSON — it is passed to the first agent.`;
        await Clipboard.setStringAsync(details).catch(() => {});
        Alert.alert('Webhook created', `Save this now — the secret is shown only once. It has been copied.\n\n${details}`);
        // The secret is never stored in the chat; only the address is.
        return { ok: true, detail: `POST ${hook.triggerUrl} — the secret was shown once and copied.` };
      }, action);
      case 'update_mission': {
        const jobId = Crypto.randomUUID();
        const summary = action.summary ?? action.label ?? 'Update the mission';
        const key = newKey();
        append({ key, role: 'assistant', content: '', action: { type: 'update_progress', jobId, summary } });
        try {
          await updateMission(missionId, summary, jobId);
        } catch (err) {
          patchItem(key, { action: null });
          await inChat('update', summary, async () => ({ ok: false, error: (err as Error).message }), action);
        }
        return;
      }
    }
  }, [append, inChat, missionId, patchItem, run]);

  const renderCard = (item: ChatItem) => {
    if (item.pending) return <PendingCard kind={item.pending.kind} label={item.pending.label} />;
    if (item.run) return <RunCard missionId={item.run.missionId} runId={item.run.runId} via="mission_chat" onRecord={record} />;
    const action = item.action as MissionAction | null | undefined;
    if (!action) return null;
    switch (action.type) {
      case 'thread_note': return <ThreadNoteRow note={action as unknown as ThreadNote} />;
      case 'run_card': return typeof action.runId === 'string' ? <RunCard missionId={missionId} runId={action.runId} via="mission_chat" onRecord={record} /> : null;
      case 'approval_record': return <ApprovalRecordCard record={action as unknown as ApprovalRecordPayload} />;
      case 'action_result': {
        const entry = action as unknown as ActionResultEntry;
        return <ResultCard entry={entry} onRetry={entry.action?.type ? () => apply(entry.action as unknown as MissionAction) : undefined} />;
      }
      case 'update_progress': return (
        <UpdateCard
          jobId={String(action.jobId)}
          summary={String(action.summary)}
          onDone={outcome => {
            patchItem(item.key, { action: null });
            inChat('update', String(action.summary), async () => outcome);
          }}
        />
      );
      default: {
        if (!ONE_SHOT.has(action.type) && action.type !== 'suggest_connector') return null;
        return (
          <Card>
            <AppText weight="600">{action.label ?? (action.type === 'suggest_connector' ? `Connect ${action.provider}` : 'Apply')}</AppText>
            {action.summary ? <AppText size="sm" tone="secondary">{action.summary}</AppText> : null}
            {item.applied && action.type !== 'suggest_connector'
              ? <AppText weight="600" tone="emerald">✓ Applied</AppText>
              : <Button label={action.type === 'suggest_connector' ? 'Connect' : 'Apply'} onPress={() => apply(action, item)} style={{ alignSelf: 'flex-start' }} />}
          </Card>
        );
      }
    }
  };

  return (
    <>
      <Stack.Screen options={{
        title: mission?.title ?? '',
        // The title over its mode, so a long title never runs under the button.
        headerTitle: () => (
          <View style={{ maxWidth: 240 }}>
            <AppText weight="700" numberOfLines={1}>{mission?.title ?? ''}</AppText>
            {mission ? <AppText size="xs" tone={mission.rehearsal ? 'amber' : 'emerald'} weight="600">{mission.rehearsal ? 'Next run: rehearsal' : 'Live'}</AppText> : null}
          </View>
        ),
        headerRight: () => <Button label={mission?.rehearsal ? 'Rehearse' : 'Run'} variant="ghost" onPress={() => run('Run this mission')} />,
      }} />
      <ChatView
        items={chat.items}
        loading={chat.loading}
        sending={chat.sending}
        onSend={chat.send}
        renderCard={renderCard}
        placeholder={`Ask about “${mission?.title ?? 'this mission'}”…`}
        alert={chat.alert}
        keyboardOffset={headerHeight}
        empty={
          <View style={{ gap: space.sm, alignItems: 'center' }}>
            <AppText weight="700">Talk to this mission’s agent</AppText>
            <AppText tone="secondary" style={{ textAlign: 'center' }}>Ask it to run, explain a result, change what it does, or put it on a schedule.</AppText>
            <Button label="Back to missions" variant="ghost" onPress={() => router.back()} />
          </View>
        }
      />
    </>
  );
}
