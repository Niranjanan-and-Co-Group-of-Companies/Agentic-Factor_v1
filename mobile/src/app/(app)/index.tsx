// The chat — the Command Center: one-time jobs done right here in the customer's apps (with their OK),
// missions built, run and scheduled. Opens a chat picked in the sidebar (?chat=…) or a new one (?fresh=…).

import type { ActionResultEntry, ApprovalRecordPayload, ChatAction, CommandAction, ResultKind } from '@contracts';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmPlanCard, OfferMissionCard } from '@/components/cards/AppActionCards';
import { BuildCard, MissionCreatedCard } from '@/components/cards/BuildCard';
import { ApprovalRecordCard, PendingCard, ResultCard } from '@/components/cards/EntryCards';
import { RunCard } from '@/components/cards/RunCard';
import { ChatView } from '@/components/chat/ChatView';
import { Icon, icons } from '@/components/Icon';
import { LogoMark } from '@/components/Logo';
import { MenuButton } from '@/components/MenuButton';
import { AppText, Button, Card } from '@/components/ui';
import { connectApp, markUsed, patchMission, retryBuild, saveResult, startRun, type Outcome } from '@/lib/actions';
import { api } from '@/lib/api';
import { appName } from '@/lib/app-name';
import { setActiveChat } from '@/lib/chat-store';
import { newKey, type ChatItem } from '@/lib/chat';
import { useChat } from '@/lib/useChat';
import { maxContentWidth, radius, space, useColors } from '@/theme';

const SUGGESTIONS = ['Summarise today’s emails', 'What ran today?', 'Check my credits', 'Automate a weekly report'];
const ONE_SHOT = new Set(['run_mission', 'schedule_mission', 'pause_mission', 'resume_mission', 'unschedule_mission']);

export default function Chat() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  // The last conversation reopens if it was used in the last 30 minutes; otherwise a new chat.
  const chat = useChat({ endpoint: '/api/command-chat', sessionsPath: '/api/command-chat/sessions', firstLoadAlert: true, resumeWithinMs: 30 * 60_000 });
  const { setItems, append, sessionId, load, newConversation } = chat;
  const params = useLocalSearchParams<{ chat?: string; fresh?: string }>();
  // The card whose button is working (a plan being approved, an offer being accepted).
  const [busyCard, setBusyCard] = useState<string | null>(null);

  // Picked in the sidebar: that chat, or a new one.
  useEffect(() => {
    if (params.fresh) newConversation();
    else if (params.chat) void load(params.chat);
  }, [params.chat, params.fresh, load, newConversation]);

  // The sidebar highlights the chat open here.
  useEffect(() => { setActiveChat(sessionId); }, [sessionId]);
  useEffect(() => () => setActiveChat(null), []);

  const patchItem = useCallback((key: string, patch: Partial<ChatItem>) => {
    setItems(prev => prev.map(i => (i.key === key ? { ...i, ...patch } : i)));
  }, [setItems]);

  /** Applies a button's action and keeps its result in the chat (and the mission's chat). */
  const inChat = useCallback(async (kind: ResultKind, label: string, mission: { id?: string; title?: string }, work: () => Promise<Outcome>, action?: ChatAction) => {
    const key = newKey();
    append({ key, role: 'assistant', content: '', pending: { kind, label } });
    const outcome = await work().catch(err => ({ ok: false, error: (err as Error).message }) as Outcome);
    const entry = await saveResult(
      { kind, label, missionId: mission.id, missionTitle: mission.title, via: 'command_center', action: action as Record<string, unknown> | undefined, ...outcome },
      { missionId: mission.id, commandSessionId: sessionId },
    );
    patchItem(key, { pending: undefined, action: entry as unknown as ChatAction, applied: true });
  }, [append, patchItem, sessionId]);

  const followRun = useCallback((missionId: string, runId: string, missionTitle?: string) => {
    append({ key: newKey(), role: 'assistant', content: '', run: { missionId, runId } });
    api('/api/chat-log', { method: 'POST', body: { entry: { type: 'run_card', runId, missionId, missionTitle }, commandSessionId: sessionId ?? undefined } }).catch(() => {});
  }, [append, sessionId]);

  const apply = useCallback(async (action: CommandAction, item?: ChatItem) => {
    if (item && ONE_SHOT.has(action.type)) { patchItem(item.key, { applied: true }); markUsed(item.id); }
    const mission = { id: action.missionId, title: action.missionTitle };
    if (action.type === 'run_mission' && action.missionId) {
      try { followRun(action.missionId, await startRun(action.missionId, action.missionStatus), action.missionTitle); }
      catch (err) { await inChat('run', action.missionTitle || 'Run this mission', mission, async () => ({ ok: false, error: (err as Error).message }), action); }
    } else if (action.type === 'schedule_mission' && action.missionId && action.cron) {
      await inChat('schedule', action.label || action.cron, mission,
        () => patchMission(action.missionId!, { action: 'schedule', scheduleConfig: { cron: action.cron, timezone: action.timezone ?? 'Asia/Kolkata' } }, action.label ?? 'Scheduled'), action);
    } else if (action.type === 'pause_mission' && action.missionId) {
      await inChat('pause', action.missionTitle || 'This mission', mission, () => patchMission(action.missionId!, { action: 'pause' }, 'Scheduled runs are on hold until you resume it.'), action);
    } else if (action.type === 'unschedule_mission' && action.missionId) {
      await inChat('unschedule', action.missionTitle || 'This mission', mission, () => patchMission(action.missionId!, { action: 'unschedule' }, 'It now runs only when you start it.'), action);
    } else if (action.type === 'resume_mission' && action.missionId) {
      await inChat('resume', action.missionTitle || 'This mission', mission, () => patchMission(action.missionId!, { action: 'resume' }, 'Scheduled runs continue.'), action);
    } else if (action.type === 'suggest_connector' && action.provider) {
      const outcome = await connectApp(action.provider);
      if (outcome) await inChat('connect', action.provider, {}, async () => outcome, action);
    } else if (action.type === 'open_mission' && action.missionId) {
      router.push(`/missions/${action.missionId}`);
    } else if (action.type === 'show_missions') {
      navigation.dispatch({ type: 'OPEN_DRAWER' });
    } else if (action.type === 'show_usage') {
      router.push('/account');
    }
  }, [followRun, inChat, navigation, patchItem]);

  const markCard = (key: string, action: CommandAction, resolved: 'applied' | 'skipped') =>
    patchItem(key, { applied: true, action: { ...action, resolved } });

  /** "Do it" on a plan: the server carries out the plan as saved; the assistant reports what was done. */
  const approvePlan = async (item: ChatItem, action: CommandAction) => {
    if (!item.id || chat.sending) return;
    markCard(item.key, action, 'applied');
    setBusyCard(item.key);
    await chat.send('Yes, go ahead.', { approve: { messageId: item.id } });
    setBusyCard(null);
  };
  /** "Yes, make it a mission": built from the offer itself. */
  const acceptOffer = async (item: ChatItem, action: CommandAction) => {
    if (!item.id || chat.sending) return;
    markCard(item.key, action, 'applied');
    setBusyCard(item.key);
    await chat.send(`Yes, make it a mission${action.label ? ` that runs ${action.label}` : ''}.`, { acceptOffer: { messageId: item.id } });
    setBusyCard(null);
  };
  const decline = (item: ChatItem, action: CommandAction) => {
    markCard(item.key, action, 'skipped');
    if (item.id) api('/api/chat-messages/resolve', { method: 'POST', body: { messageId: item.id, outcome: 'skipped' } }).catch(() => {});
  };

  const record = (r: ApprovalRecordPayload) => append({ key: newKey(), role: 'assistant', content: '', action: r as unknown as ChatAction, applied: true });

  const renderCard = (item: ChatItem) => {
    if (item.pending) return <PendingCard kind={item.pending.kind} label={item.pending.label} />;
    if (item.run) return <RunCard missionId={item.run.missionId} runId={item.run.runId} via="command_center" onRecord={r => record(r)} onOpenMission={() => router.push(`/missions/${item.run!.missionId}`)} />;
    const action = item.action as CommandAction | null | undefined;
    if (!action) return null;
    switch (action.type) {
      case 'action_result': {
        const entry = action as unknown as ActionResultEntry;
        return <ResultCard entry={entry} onRetry={entry.action?.type ? () => apply(entry.action as unknown as CommandAction) : undefined} />;
      }
      case 'approval_record': return <ApprovalRecordCard record={action as unknown as ApprovalRecordPayload} />;
      case 'run_card': return action.missionId && typeof action.runId === 'string'
        ? <RunCard missionId={action.missionId} runId={action.runId} via="command_center" onRecord={r => record(r)} onOpenMission={() => router.push(`/missions/${action.missionId}`)} />
        : null;
      case 'building_blueprint': return action.jobId ? (
        <BuildCard
          jobId={action.jobId}
          onJobChange={jobId => patchItem(item.key, { action: { ...action, jobId } })}
          onCreated={created => patchItem(item.key, { action: created })}
          onQuestion={question => patchItem(item.key, { action: { type: 'blueprint_question', question }, content: `${item.content}\n\n**Before I build this — one question from the Mission Architect:**\n${question}` })}
        />
      ) : null;
      case 'mission_created': return (
        <MissionCreatedCard
          action={action}
          onOpen={() => router.push(`/missions/${action.missionId}`)}
          onRun={() => apply({ type: 'run_mission', missionId: action.missionId, missionTitle: action.missionTitle, missionStatus: 'active' })}
        />
      );
      case 'mission_create_error': return (
        <Card tone="error">
          <AppText weight="700" tone="rose">Could not create the mission</AppText>
          {action.error ? <AppText tone="secondary">{action.error}</AppText> : null}
          {action.jobId ? <Button label="Try again" variant="ghost" style={{ alignSelf: 'flex-start' }} onPress={async () => {
            try { patchItem(item.key, { action: { type: 'building_blueprint', jobId: await retryBuild(action.jobId!) } }); }
            catch (err) { patchItem(item.key, { action: { ...action, error: (err as Error).message } }); }
          }} /> : null}
        </Card>
      );
      case 'blueprint_question': return <AppText size="sm" tone="muted">Reply below and the mission will be built with your answer.</AppText>;
      case 'run_mission': return (
        <ActionRow title={`Run “${action.missionTitle ?? 'mission'}”`} used={item.applied}
          primary={{ label: 'Run now', onPress: () => apply(action, item) }}
          secondary={action.missionId ? { label: 'Open mission', onPress: () => router.push(`/missions/${action.missionId}`) } : undefined} />
      );
      case 'schedule_mission': return <ActionRow title={`Schedule “${action.missionTitle ?? 'mission'}”`} detail={action.label} used={item.applied} primary={{ label: 'Apply', onPress: () => apply(action, item) }} />;
      case 'pause_mission': return <ActionRow title={`Pause “${action.missionTitle ?? 'mission'}”`} used={item.applied} primary={{ label: 'Pause', onPress: () => apply(action, item) }} />;
      case 'resume_mission': return <ActionRow title={`Resume “${action.missionTitle ?? 'mission'}”`} used={item.applied} primary={{ label: 'Resume', onPress: () => apply(action, item) }} />;
      case 'unschedule_mission': return <ActionRow title={`Remove the schedule of “${action.missionTitle ?? 'mission'}”`} used={item.applied} primary={{ label: 'Remove schedule', onPress: () => apply(action, item) }} />;
      case 'suggest_connector': return <ActionRow title={`Connect ${action.providerName ?? appName(action.provider ?? '')}`} detail={action.reason} primary={{ label: 'Connect', onPress: () => apply(action, item) }} />;
      case 'confirm_app_actions': return (
        <ConfirmPlanCard action={action} used={item.applied} busy={busyCard === item.key} onApprove={() => approvePlan(item, action)} onDecline={() => decline(item, action)} />
      );
      case 'offer_mission': return (
        <OfferMissionCard action={action} used={item.applied} busy={busyCard === item.key} onAccept={() => acceptOffer(item, action)} onDecline={() => decline(item, action)} />
      );
      case 'open_mission': return <ActionRow title={action.missionTitle ?? 'Mission'} primary={{ label: 'Open chat', onPress: () => apply(action) }} />;
      case 'show_missions': return <ActionRow title="Your missions" detail="They’re in the sidebar, under Missions." primary={{ label: 'Open the sidebar', onPress: () => apply(action) }} />;
      case 'show_usage': return <ActionRow title="Usage and credits" primary={{ label: 'View usage', onPress: () => apply(action) }} />;
      default: return null;
    }
  };

  return (
    <ChatView
      items={chat.items}
      loading={chat.loading}
      sending={chat.sending}
      onSend={chat.send}
      renderCard={renderCard}
      placeholder="Ask anything or give a command…"
      alert={chat.alert}
      header={
        <View style={[styles.header, { paddingTop: insets.top + space.xs, borderBottomColor: c.border }]}>
          <MenuButton />
          <View style={styles.brand}>
            <LogoMark height={16} />
            <AppText weight="700" accessibilityRole="header">Agentic Factor</AppText>
          </View>
          <Pressable
            onPress={newConversation}
            disabled={chat.items.length === 0}
            accessibilityRole="button"
            accessibilityLabel="New chat"
            hitSlop={8}
            style={({ pressed }) => [styles.iconButton, { opacity: chat.items.length === 0 ? 0.35 : pressed ? 0.6 : 1 }]}
          >
            <Icon name={icons.newChat} color={c.text} />
          </Pressable>
        </View>
      }
      empty={
        <View style={{ gap: space.md, alignItems: 'center', maxWidth: maxContentWidth }}>
          <LogoMark height={34} />
          <AppText size="xl" weight="700" style={{ textAlign: 'center' }}>What should I get done?</AppText>
          <AppText tone="secondary" style={{ textAlign: 'center' }}>Ask in your own words. I’ll do it right here with your apps — and ask before anything is sent or changed. For things you need regularly, I’ll set up a mission.</AppText>
          <View style={styles.chips}>
            {SUGGESTIONS.map(s => (
              <Pressable key={s} accessibilityRole="button" onPress={() => chat.send(s)} style={({ pressed }) => [styles.chip, { borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.7 : 1 }]}>
                <AppText size="sm">{s}</AppText>
              </Pressable>
            ))}
          </View>
        </View>
      }
    />
  );
}

function ActionRow({ title, detail, used, primary, secondary }: {
  title: string; detail?: string; used?: boolean;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  return (
    <Card>
      <AppText weight="600">{title}</AppText>
      {detail ? <AppText size="sm" tone="secondary">{detail}</AppText> : null}
      <View style={styles.buttons}>
        {used ? <AppText weight="600" tone="emerald">✓ Applied</AppText> : <Button label={primary.label} onPress={primary.onPress} />}
        {secondary ? <Button label={secondary.label} variant="ghost" onPress={secondary.onPress} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, paddingBottom: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 40, justifyContent: 'center' },
  buttons: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' },
});
