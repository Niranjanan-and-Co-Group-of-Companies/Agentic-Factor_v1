'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import OnboardingTour from '@/components/OnboardingTour';
import MissionsSidebar from '@/components/MissionsSidebar';
import { renderMarkdown } from '@/lib/utils/render-markdown';
import { withArchitectQuestion } from '@/lib/utils/architect-question';

import Glyph from "@/components/ui/Glyph";
import ConnectorLogo from "@/components/ConnectorLogos";
import { AppName } from '@/components/apps/AppInfo';
import { appNameNow } from '@/components/apps/useAppInfo';
import { describeNextRun } from '@/lib/services/cron-match';
import { LogoMark } from "@/components/brand/Logo";
import LiveRunCard, { RunStrip } from '@/components/runs/LiveRunCard';
import { kickLive } from '@/components/runs/useLiveRun';
import PendingApprovals from '@/components/runs/PendingApprovals';
import { ApprovalRecord, type ApprovalRecordPayload } from '@/components/runs/Approval';
import { ActionResult, PendingResult, entryType, type ActionResultEntry, type ResultKind } from '@/components/runs/ActionResult';
import { decisionText } from '@/lib/services/approval-records';
import type { AppActionStep } from '@/lib/contracts';
// ── Types ──────────────────────────────────────────────────────────────────────

interface ChatSession { id: string; title: string; updated_at: string; }
interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  action_payload?: ActionPayload | null;
  /** The action card was used (applied); saved with the message so it stays used after a reload. */
  action_applied?: boolean;
  isStreaming?: boolean;
  processingAction?: string;
  ts?: number;
  /** A live card for a run started from here (client-only, not saved with the chat). */
  run?: { missionId: string; runId: string };
  /** An approval decided here; the server saved it into that mission's chat too. */
  approval?: { record: ApprovalRecordPayload; missionId: string; missionTitle?: string };
  /** A button's action while it is being applied (replaced by its saved result). */
  pendingResult?: { kind: ResultKind; label: string };
}
interface AgentCard { name: string; icon?: string; role: string; tool?: string; trustLevel?: string; }
interface RequiredConnector { service: string; reason: string; connected: boolean; }
interface ActionPayload {
  type: string;
  jobId?: string;
  missionId?: string;
  missionTitle?: string;
  missionStatus?: string;
  cron?: string;
  timezone?: string;
  label?: string;
  provider?: string;
  reason?: string;
  intent?: string;
  question?: string;
  error?: string;
  accountInfo?: string;
  agents?: AgentCard[];
  orchestrationPattern?: string;
  requiredConnectors?: RequiredConnector[];
  /** The build conversation was moved into the new mission's chat. */
  movedToChat?: boolean;
  /** What the build cost (real cost × markup; the failure rate when it failed). */
  credits?: number;
  /** confirm_app_actions: a one-time job's steps waiting for the customer's OK. */
  summary?: string;
  steps?: AppActionStep[];
  /** Set once the card's button was used. */
  resolved?: 'applied' | 'skipped';
}
/** How far a build's code steps have got: one entry per agent whose code is being written. */
interface BuildProgress { roles: string[]; ready: string[] }
interface MissionShortcut { id: string; title: string; status: string; }
/** Cards that do something once (navigation cards stay usable). */
const ONE_SHOT_ACTIONS = new Set(['run_mission', 'schedule_mission', 'pause_mission', 'resume_mission', 'unschedule_mission']);
type RunInChat = (
  kind: ResultKind, label: string, mission: { id?: string; title?: string },
  work: () => Promise<{ ok: boolean; detail?: string; error?: string }>, action?: ActionPayload,
) => Promise<void>;

// ── Helpers ────────────────────────────────────────────────────────────────────

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function groupByDate(sessions: ChatSession[]) {
  const groups: Record<string, ChatSession[]> = {};
  const now = new Date();
  for (const s of sessions) {
    const diff = Math.floor((now.getTime() - new Date(s.updated_at).getTime()) / 86400000);
    const key = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff <= 7 ? 'This Week' : 'Older';
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }
  return groups;
}

function statusDot(status: string) {
  const colors: Record<string, string> = {
    active: 'var(--emerald)', failed: 'var(--red,var(--rose))',
    paused: 'var(--amber)', draft: 'var(--text-muted)', completed: 'var(--purple)',
  };
  return colors[status] ?? 'var(--text-muted)';
}


const QUICK_CHIPS = ['What ran today?', 'Check my credits', 'Show all missions', 'Create a new mission'];
// The conversation this tab had open: back on the Command Center within this time (after connecting an
// app or opening a mission), it reopens instead of starting empty.
const LAST_CHAT_KEY = 'af.commandCenter.lastChat';
const RESUME_MS = 30 * 60_000;
// Connector names come from Composio's catalog (any app); this is for plain-text messages.
const connectorMeta = (s: string) => ({ label: appNameNow(s) });

// Connector auth type lookup — determines inline connect flow
const APIKEY_CONNECTORS = new Set(['openai', 'gemini', 'anthropic', 'buffer', 'sendgrid', 'twilio', 'apollo', 'razorpay', 'elevenlabs', 'heygen', 'runwayml', 'tavily', 'stripe', 'bamboohr', 'firebase', 'zendesk']);
const API_KEY_FIELD_LABELS: Record<string, string> = {
  openai: 'API Key (sk-...)', gemini: 'API Key (from aistudio.google.com)',
  anthropic: 'API Key (sk-ant-...)', buffer: 'Access Token (from buffer.com/developers)',
  stripe: 'Secret Key (sk_live_...)', sendgrid: 'API Key (SG...)',
  twilio: 'Auth Token', apollo: 'API Key', elevenlabs: 'API Key',
  tavily: 'API Key', razorpay: 'Key Secret',
};

// ── Main Component ─────────────────────────────────────────────────────────────

function CommandCenterPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Chat state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Bumped after each reply, so the sidebar's chat list shows a new or renamed chat.
  const [chatsVersion, setChatsVersion] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState<string>('');
  const [toast, setToast] = useState<string | null>(null);
  const [applyingAction, setApplyingAction] = useState<number | null>(null);
  // The mission whose run was last started from here: its progress shows in the strip.
  const [trackedMissionId, setTrackedMissionId] = useState<string | null>(null);

  // Voice
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // File upload
  const [pendingFile, setPendingFile] = useState<{ name: string; assetId?: string; uploading: boolean; error?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [blueprintSteps, setBlueprintSteps] = useState<Record<string, string>>({});
  const [blueprintProgress, setBlueprintProgress] = useState<Record<string, BuildProgress>>({});

  // Inline connector state (for connecting directly from blueprint card in chat)
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [connectedInSession, setConnectedInSession] = useState<Set<string>>(new Set());
  const [inlineApiKeyModal, setInlineApiKeyModal] = useState<{ service: string } | null>(null);
  const [inlineApiKeyValue, setInlineApiKeyValue] = useState('');
  const [inlineApiKeySaving, setInlineApiKeySaving] = useState(false);
  const [inlineApiKeyError, setInlineApiKeyError] = useState<string | null>(null);
  const [inlineApiKeySuccess, setInlineApiKeySuccess] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const blueprintPollsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // Connector callbacks are set up before runInChat exists; they reach it through this.
  const runInChatRef = useRef<RunInChat | null>(null);
  // Connecting from a "connect this app" card: once connected, the conversation carries on by itself.
  const continueAfterConnectRef = useRef<string | null>(null);
  const sendMessageRef = useRef<((text: string) => Promise<void>) | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    loadSessions();
    fetch('/api/platform/welcome-message')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.message) setWelcomeMessage(d.message); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-focus + pre-fill when ?new=1 is in URL (from "New Mission" button) ──
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setInput('Create a mission that ');
      setTimeout(() => {
        inputRef.current?.focus();
        // Move cursor to end
        const el = inputRef.current;
        if (el) { el.selectionStart = el.selectionEnd = el.value.length; }
      }, 150);
      // Clean up URL without triggering a re-render
      router.replace('/dashboard', { scroll: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadSessions = useCallback(async () => {
    const res = await fetch('/api/command-chat/sessions', { credentials: 'include' });
    if (res.ok) { const d = await res.json() as { sessions: ChatSession[] }; setSessions(d.sessions ?? []); }
  }, []);


  // ── Proactive alert on first open ──────────────────────────────────────────
  useEffect(() => {
    fetch('/api/command-chat', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [], isFirstLoad: true }),
    }).then(async res => {
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            JSON.parse(line.slice(6)); // parse but ignore proactive_alert — welcome message handles empty state
          } catch { /* skip */ }
        }
      }
    }).catch(() => {});
  }, []);

  // ── Scroll to bottom ───────────────────────────────────────────────────────
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ── Cleanup polling ────────────────────────────────────────────────────────
  useEffect(() => () => {
    for (const poll of blueprintPollsRef.current.values()) clearInterval(poll);
  }, []);

  // ── OAuth popup result listener (for inline connect from blueprint card) ──
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.data?.type === 'OAUTH_SUCCESS') {
        const provider = e.data.provider as string ?? '';
        setConnectedInSession(prev => { const s = new Set(prev); s.add(provider); return s; });
        setConnectingSlug(null);
        if (continueAfterConnectRef.current === provider) {
          // The assistant asked for this app: tell it, so it continues where it left off.
          continueAfterConnectRef.current = null;
          void sendMessageRef.current?.(`I've connected ${connectorMeta(provider).label}.`);
        } else {
          void runInChatRef.current?.('connect', connectorMeta(provider).label, {}, async () => ({ ok: true, detail: 'Ready to use in your missions.' }));
        }
      } else if (e.data?.type === 'OAUTH_ERROR') {
        setConnectingSlug(null);
        const why = typeof e.data.payload === 'string' ? e.data.payload : 'The sign-in did not complete.';
        void runInChatRef.current?.('connect', 'The app', {}, async () => ({ ok: false, error: why }));
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, []);

  // ── Connect a service directly from within the chat ────────────────────────
  const handleConnectInChat = useCallback(async (service: string) => {
    if (APIKEY_CONNECTORS.has(service)) {
      setInlineApiKeyValue(''); setInlineApiKeyError(null);
      setInlineApiKeySuccess(false); setInlineApiKeyModal({ service });
      return;
    }
    setConnectingSlug(service);
    // Opened straight from the click, before the request: Safari blocks a window opened after waiting on one.
    const popup = window.open('', 'oauth_window', 'width=500,height=700,scrollbars=yes');
    try {
      const res = await fetch('/api/composio/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ provider: service }),
      });
      const data = await res.json() as { authUrl?: string; error?: string };
      if (!res.ok || !data.authUrl) {
        // OAuth unavailable — fall back to API key modal
        popup?.close();
        setConnectingSlug(null);
        setInlineApiKeyValue(''); setInlineApiKeyError(null);
        setInlineApiKeySuccess(false); setInlineApiKeyModal({ service });
        return;
      }
      if (!popup) {
        setConnectingSlug(null);
        continueAfterConnectRef.current = null;
        void runInChatRef.current?.('connect', connectorMeta(service).label, {}, async () => ({ ok: false, error: 'Your browser blocked the sign-in window. Allow pop-ups for this site, then click Connect again.' }));
        return;
      }
      popup.location.href = data.authUrl;
      const poll = setInterval(() => {
        if (!popup.closed) return;
        clearInterval(poll);
        setConnectingSlug(null);
        // Closed without connecting: no longer waiting. (Its success message arrives just before it closes.)
        setTimeout(() => { if (continueAfterConnectRef.current === service) continueAfterConnectRef.current = null; }, 2000);
      }, 500);
    } catch {
      popup?.close();
      continueAfterConnectRef.current = null;
      setConnectingSlug(null);
      void runInChatRef.current?.('connect', connectorMeta(service).label, {}, async () => ({ ok: false, error: 'Could not start the connection. Try again.' }));
    }
  }, []);

  // ── Save API key entered in inline modal ───────────────────────────────────
  const handleInlineApiKeySave = useCallback(async () => {
    if (!inlineApiKeyModal || !inlineApiKeyValue.trim()) { setInlineApiKeyError('API key is required'); return; }
    setInlineApiKeySaving(true); setInlineApiKeyError(null);
    try {
      const verifyRes = await fetch('/api/connectors/apikey/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ provider: inlineApiKeyModal.service, fields: { apiKey: inlineApiKeyValue.trim() } }),
      });
      const verifyData = await verifyRes.json() as { verified: boolean; error?: string };
      if (!verifyData.verified) { setInlineApiKeyError(verifyData.error ?? 'Invalid API key — please check and try again.'); setInlineApiKeySaving(false); return; }

      const saveRes = await fetch('/api/connectors/apikey', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ provider: inlineApiKeyModal.service, fields: { apiKey: inlineApiKeyValue.trim() } }),
      });
      const saveData = await saveRes.json() as { success?: boolean; error?: string };
      if (!saveRes.ok || !saveData.success) { setInlineApiKeyError(saveData.error ?? 'Failed to save'); setInlineApiKeySaving(false); return; }

      setInlineApiKeySuccess(true);
      const svc = inlineApiKeyModal.service;
      setConnectedInSession(prev => { const s = new Set(prev); s.add(svc); return s; });
      setTimeout(() => {
        if (continueAfterConnectRef.current === svc) {
          continueAfterConnectRef.current = null;
          void sendMessageRef.current?.(`I've connected ${connectorMeta(svc).label}.`);
        } else {
          void runInChatRef.current?.('connect', connectorMeta(svc).label, {}, async () => ({ ok: true, detail: 'Your key is saved and checked.' }));
        }
        setInlineApiKeyModal(null); setInlineApiKeyValue(''); setInlineApiKeySuccess(false);
      }, 1000);
    } catch { setInlineApiKeyError('Network error. Please try again.'); }
    setInlineApiKeySaving(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineApiKeyModal, inlineApiKeyValue]);

  // ── Load session ───────────────────────────────────────────────────────────
  const loadSession = async (sessionId: string) => {
    setActiveSessionId(sessionId); setMessages([]);
    const res = await fetch('/api/command-chat/sessions', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => null);
    if (res?.ok) { const d = await res.json() as { messages: ChatMessage[] }; setMessages(d.messages ?? []); return; }
    // Gone (deleted, or not this account's): start fresh instead of writing into it.
    setActiveSessionId(null);
    try { sessionStorage.removeItem(LAST_CHAT_KEY); } catch { /* storage unavailable */ }
    router.replace('/dashboard', { scroll: false });
  };

  const startNewChat = () => {
    setActiveSessionId(null); setMessages([]); setInput('');
    try { sessionStorage.removeItem(LAST_CHAT_KEY); } catch { /* storage unavailable */ }
    router.replace('/dashboard', { scroll: false });
    inputRef.current?.focus();
  };

  // Reopen the conversation: the one the address names, or — back on the Command Center soon after leaving
  // it (to connect an app, open a mission…) — the one this tab had open.
  // (A chat named in the address is opened by the effect below.)
  useEffect(() => {
    if (searchParams.get('chat') || searchParams.get('new') === '1' || searchParams.get('fresh') === '1') return;
    let id: string | null = null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(LAST_CHAT_KEY) ?? 'null') as { id?: string; at?: number } | null;
      if (saved?.id && saved.at && Date.now() - saved.at < RESUME_MS) id = saved.id;
    } catch { /* storage unavailable */ }
    // Loaded a moment later, not inside the effect itself (it sets state).
    if (id) { const chatId = id; void Promise.resolve().then(() => loadSession(chatId)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The sidebar links here: ?chat=… opens that conversation, ?fresh=1 starts a new one.
  useEffect(() => {
    const chat = searchParams.get('chat');
    if (searchParams.get('fresh') === '1') { void Promise.resolve().then(startNewChat); return; }
    if (chat && chat !== activeSessionId) void Promise.resolve().then(() => loadSession(chat));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // The open conversation is in the address (Back and refresh keep it) and remembered for this tab.
  useEffect(() => {
    if (!activeSessionId) return;
    if (searchParams.get('chat') !== activeSessionId) router.replace(`/dashboard?chat=${activeSessionId}`, { scroll: false });
    try { sessionStorage.setItem(LAST_CHAT_KEY, JSON.stringify({ id: activeSessionId, at: Date.now() })); } catch { /* storage unavailable */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, messages.length]);

  // ── Delete session ─────────────────────────────────────────────────────────
  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch('/api/command-chat/sessions', {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (activeSessionId === sessionId) { setActiveSessionId(null); setMessages([]); }
    loadSessions();
  };

  // ── Save what happened into this conversation's history (and the mission's chat when given) ──
  const saveToHistory = useCallback(async (entry: Record<string, unknown>, missionId?: string) => {
    if (!activeSessionId && !missionId) return null;
    try {
      const res = await fetch('/api/chat-log', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry, missionId, commandSessionId: activeSessionId ?? undefined }),
      });
      return res.ok ? await res.json() as { entry?: ActionResultEntry; text?: string } : null;
    } catch {
      return null;
    }
  }, [activeSessionId]);

  // ── An assistant's action card, once used, stays used (saved with its message) ──
  const markCardUsed = (index: number) => {
    const target = messages[index];
    if (!target) return;
    setMessages(prev => prev.map((m, j) => (j === index ? { ...m, action_applied: true } : m)));
    if (target.id && !target.id.startsWith('pending-')) {
      fetch('/api/chat-messages/resolve', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: target.id, outcome: 'applied' }),
      }).catch(() => { /* used on screen; may show again after a reload */ });
    }
  };

  // ── A button's result, kept in the chat: "Applying…", then ✓ or ✗ with the reason ──
  const runInChat = useCallback(async (
    kind: ResultKind, label: string, mission: { id?: string; title?: string },
    work: () => Promise<{ ok: boolean; detail?: string; error?: string }>, action?: ActionPayload,
  ) => {
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages(prev => [...prev, { id: tempId, role: 'assistant', content: '', ts: Date.now(), pendingResult: { kind, label } }]);
    let result: { ok: boolean; detail?: string; error?: string };
    try { result = await work(); } catch { result = { ok: false, error: 'Could not reach the server. Check your connection and try again.' }; }
    const entry = { type: 'action_result', kind, ok: result.ok, label, detail: result.detail, error: result.error, missionId: mission.id, missionTitle: mission.title, via: 'command_center', action };
    const saved = await saveToHistory(entry, mission.id);
    const finalEntry = saved?.entry ?? ({ ...entry, at: new Date().toISOString() } as ActionResultEntry);
    setMessages(prev => prev.map(m => (m.id === tempId
      ? { role: 'assistant', content: saved?.text ?? '', action_payload: finalEntry as unknown as ActionPayload, ts: Date.now() }
      : m)));
  }, [saveToHistory]);
  useEffect(() => { runInChatRef.current = runInChat; }, [runInChat]);

  // ── An approval decided here shows in this chat (it is saved in the mission's chat too) ──
  const addApprovalRecord = useCallback((record: ApprovalRecordPayload, missionId: string, missionTitle?: string) => {
    setMessages(prev => prev.some(m => m.approval?.record.actionId === record.actionId)
      ? prev
      : [...prev, { role: 'assistant', content: decisionText(record), ts: Date.now(), approval: { record, missionId, missionTitle } }]);
    void saveToHistory({ ...record, missionId, missionTitle });
  }, [saveToHistory]);

  // ── Follow a run with a live card in the chat ─────────────────────────────
  const followRun = useCallback((missionId: string, runId: string, missionTitle?: string) => {
    let added = false;
    setMessages(prev => {
      if (prev.some(m => m.run?.runId === runId)) return prev;
      added = true;
      return [...prev, { role: 'assistant', content: '', ts: Date.now(), run: { missionId, runId } }];
    });
    setTrackedMissionId(missionId);
    kickLive(missionId);
    // The mission's chat records the run itself; this conversation keeps its own copy.
    if (added) void saveToHistory({ type: 'run_card', runId, missionId, missionTitle });
  }, [saveToHistory]);

  // ── Blueprint polling: pick up Inngest progress + completion ──────────────
  const startBlueprintPolling = useCallback((jobId: string) => {
    if (blueprintPollsRef.current.has(jobId)) {
      clearInterval(blueprintPollsRef.current.get(jobId)!);
    }

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/blueprint-status?jobId=${encodeURIComponent(jobId)}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json() as {
          status?: string; step?: string;
          missionId?: string; missionTitle?: string;
          agents?: AgentCard[]; orchestrationPattern?: string;
          requiredConnectors?: RequiredConnector[]; error?: string;
          question?: string; progress?: BuildProgress; movedToChat?: boolean; credits?: number;
        };

        if (data.step) setBlueprintSteps(prev => ({ ...prev, [jobId]: data.step! }));
        if (data.progress) setBlueprintProgress(prev => ({ ...prev, [jobId]: data.progress! }));

        if (data.status === 'completed' && data.missionId) {
          clearInterval(poll); blueprintPollsRef.current.delete(jobId);
          setMessages(prev => {
            const updated = [...prev];
            const idx = updated.findIndex(m => m.action_payload?.type === 'building_blueprint' && m.action_payload.jobId === jobId);
            if (idx === -1) return prev;
            updated[idx] = { ...updated[idx], action_payload: {
              type: 'mission_created',
              missionId: data.missionId, missionTitle: data.missionTitle,
              agents: data.agents ?? [], orchestrationPattern: data.orchestrationPattern,
              requiredConnectors: data.requiredConnectors ?? [],
              movedToChat: data.movedToChat,
              credits: data.credits,
            }};
            return updated;
          });
        } else if (data.status === 'discovery' && data.question) {
          // The architect needs one answer first: show the question in the message so the reply goes back with it.
          const question = data.question;
          clearInterval(poll); blueprintPollsRef.current.delete(jobId);
          setMessages(prev => {
            const updated = [...prev];
            const idx = updated.findIndex(m => m.action_payload?.type === 'building_blueprint' && m.action_payload.jobId === jobId);
            if (idx === -1) return prev;
            updated[idx] = { ...updated[idx], content: withArchitectQuestion(updated[idx].content, question), action_payload: { type: 'blueprint_question', question } };
            return updated;
          });
          inputRef.current?.focus();
        } else if (data.status === 'failed') {
          clearInterval(poll); blueprintPollsRef.current.delete(jobId);
          setMessages(prev => {
            const updated = [...prev];
            const idx = updated.findIndex(m => m.action_payload?.type === 'building_blueprint' && m.action_payload.jobId === jobId);
            if (idx === -1) return prev;
            // The real reason, and the job, so "Try again" can rebuild it as it was asked for.
            updated[idx] = { ...updated[idx], action_payload: { type: 'mission_create_error', error: data.error ?? 'The build stopped without saying why.', jobId, credits: data.credits }};
            return updated;
          });
        }
      } catch { /* non-fatal */ }
    }, 2500);

    blueprintPollsRef.current.set(jobId, poll);

    // A failed build reports itself straight away; this only covers a job that never reports back.
    setTimeout(() => {
      if (!blueprintPollsRef.current.has(jobId)) return;
      clearInterval(blueprintPollsRef.current.get(jobId)!);
      blueprintPollsRef.current.delete(jobId);
      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(m => m.action_payload?.type === 'building_blueprint' && m.action_payload.jobId === jobId);
        if (idx === -1 || updated[idx]?.action_payload?.type !== 'building_blueprint') return prev;
        updated[idx] = { ...updated[idx], action_payload: { type: 'mission_create_error', error: 'No word from the build for 20 minutes. Check your Missions list — it may have been created. Otherwise try again.', jobId }};
        return updated;
      });
    }, 20 * 60 * 1000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Try a failed build again, with the request it was started with ─────────
  const retryBuild = async (jobId: string | undefined, msgIndex: number) => {
    const showError = (error: string) => setMessages(prev => prev.map((m, i) =>
      i === msgIndex && m.action_payload ? { ...m, action_payload: { ...m.action_payload, error } } : m));
    if (!jobId) { setInput('Create a mission that '); inputRef.current?.focus(); return; }
    setApplyingAction(msgIndex);
    try {
      const res = await fetch('/api/blueprint-status/retry', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId }),
      });
      const data = await res.json().catch(() => ({})) as { jobId?: string; error?: string };
      if (res.ok && data.jobId) {
        const next = data.jobId;
        setMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, action_payload: { type: 'building_blueprint', jobId: next } } : m));
        startBlueprintPolling(next);
      } else {
        showError(data.error ?? 'Could not start the build again.');
        if (res.status === 404) { setInput('Create a mission that '); inputRef.current?.focus(); }
      }
    } catch {
      showError('Could not reach the server to start the build again.');
    }
    setApplyingAction(null);
  };

  // The reply is saved before its stream ends, but a stream can stall on the way to the browser
  // (the server had finished; the chat spun for minutes). Finds this message's saved reply instead.
  const recoverSavedReply = async (sentText: string, sentAt: number): Promise<{ content: string; action: ActionPayload | null; sessionId: string } | null> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        let sessionId = activeSessionId;
        if (!sessionId) {
          const res = await fetch('/api/command-chat/sessions', { credentials: 'include' });
          const d = res.ok ? await res.json() as { sessions: ChatSession[] } : { sessions: [] };
          sessionId = d.sessions.find(x => new Date(x.updated_at ?? 0).getTime() >= sentAt - 120_000)?.id ?? null;
        }
        if (sessionId) {
          const res = await fetch('/api/command-chat/sessions', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });
          const d = res.ok ? await res.json() as { messages: Array<{ role: string; content: string; action_payload: ActionPayload | null }> } : { messages: [] };
          const asked = d.messages.map(m => m.role === 'user' && m.content === sentText).lastIndexOf(true);
          const reply = asked >= 0 ? d.messages.slice(asked + 1).find(m => m.role === 'assistant') : undefined;
          if (reply) return { content: reply.content ?? '', action: reply.action_payload ?? null, sessionId };
        }
      } catch { /* try again */ }
      await new Promise(r => setTimeout(r, 5000));
    }
    return null;
  };

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = async (text: string, card?: { approve?: string; acceptOffer?: string }) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    // Prepend attachment notice so the AI knows a file was shared
    const attachment = pendingFile && !pendingFile.uploading && !pendingFile.error ? pendingFile : null;
    const finalText = attachment ? `[Attached: ${attachment.name}]\n\n${trimmed}` : trimmed;
    if (attachment) setPendingFile(null);

    const sentAt = Date.now();
    const userMsg: ChatMessage = { role: 'user', content: finalText, ts: sentAt };
    const newMessages = [...messages, userMsg];
    setMessages([...newMessages, { role: 'assistant', content: '', isStreaming: true }]);
    setIsStreaming(true);

    try {
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/command-chat', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages, sessionId: activeSessionId,
          ...(card?.approve ? { approve: { messageId: card.approve } } : {}),
          ...(card?.acceptOffer ? { acceptOffer: { messageId: card.acceptOffer } } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setMessages([...newMessages, { role: 'assistant', content: `${err.error ?? 'Something went wrong.'}` }]);
        setIsStreaming(false); return;
      }

      const reader = res.body!.getReader(); const dec = new TextDecoder();
      let streamed = ''; let buf = '';
      let finished = false;
      const STALL_MS = 45_000;

      while (true) {
        let stallTimer: ReturnType<typeof setTimeout> | undefined;
        const stalled = new Promise<'stalled'>(r => { stallTimer = setTimeout(() => r('stalled'), STALL_MS); });
        const next = await Promise.race([reader.read(), stalled]);
        clearTimeout(stallTimer);
        if (next === 'stalled') { reader.cancel().catch(() => {}); break; }
        const { done, value } = next; if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as {
              type: string; text?: string; message?: string; cleanText?: string; content?: string;
              action?: ActionPayload; sessionId?: string; messageId?: string | null;
              credits?: number; inputTokens?: number; outputTokens?: number;
            };
            if (evt.type === 'delta' && evt.text) {
              streamed += evt.text;
              // Strip complete and incomplete <action> blocks — never show raw JSON to user
              let displayText = streamed
                .replace(/<action>[\s\S]*?<\/action>/g, '')
                .replace(/<action>[\s\S]*$/, '')
                .trim();
              // Detect which action type is being generated so we can show the right loading card
              let processingAction: string | undefined;
              if (/<action>/.test(streamed)) {
                const m = streamed.match(/"type"\s*:\s*"([^"]+)"/);
                processingAction = m ? m[1] : 'pending';
              }
              setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: displayText, isStreaming: true, processingAction }; return u; });
            }
            if (evt.type === 'extra_message') {
              // The mission built alongside the plan: its card goes just before the reply.
              const extra: ChatMessage = { id: evt.messageId ?? undefined, role: 'assistant', content: evt.content ?? '', action_payload: evt.action ?? null, ts: Date.now() };
              setMessages(prev => [...prev.slice(0, -1), extra, prev[prev.length - 1]]);
              if (evt.action?.type === 'building_blueprint' && evt.action.jobId) startBlueprintPolling(evt.action.jobId);
            }
            if (evt.type === 'done') {
              finished = true;
              const final = evt.cleanText ?? streamed;
              const action = evt.action ?? null;
              setMessages(prev => { const u = [...prev]; u[u.length - 1] = { id: evt.messageId ?? undefined, role: 'assistant', content: final, action_payload: action, isStreaming: false, ts: Date.now() }; return u; });
              // If the server queued a blueprint generation job, start polling for completion
              if (action?.type === 'building_blueprint' && action.jobId) {
                startBlueprintPolling(action.jobId);
              }
              if (evt.sessionId && !activeSessionId) { setActiveSessionId(evt.sessionId); loadSessions(); }
              setChatsVersion(v => v + 1);
            }
            if (evt.type === 'error') {
              finished = true;
              setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: `${evt.message ?? evt.text ?? 'Error'}` }; return u; });
            }
          } catch { /* skip */ }
        }
      }
      if (!finished) {
        const saved = await recoverSavedReply(finalText, sentAt);
        if (saved) {
          setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: saved.content, action_payload: saved.action, isStreaming: false, ts: Date.now() }; return u; });
          if (saved.action?.type === 'building_blueprint' && saved.action.jobId) startBlueprintPolling(saved.action.jobId);
          if (!activeSessionId) { setActiveSessionId(saved.sessionId); loadSessions(); }
        } else {
          setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: 'The reply did not arrive. Please try again.' }; return u; });
        }
      }
    } catch { setMessages([...newMessages, { role: 'assistant', content: 'Connection error. Please try again.' }]); }
    setIsStreaming(false); inputRef.current?.focus();
  };
  // The connect callbacks (set up once) send through the current sendMessage, which sees the current chat.
  useEffect(() => { sendMessageRef.current = sendMessage; });

  // ── A one-time job's plan, or a mission offer: OK'd here, carried out by the server ──
  const setCardResolved = (index: number, resolved: 'applied' | 'skipped') =>
    setMessages(prev => prev.map((m, j) => (j === index && m.action_payload
      ? { ...m, action_applied: true, action_payload: { ...m.action_payload, resolved } }
      : m)));
  const approvePlan = (index: number) => {
    const id = messages[index]?.id;
    if (!id || isStreaming) return;
    setCardResolved(index, 'applied');
    void sendMessage('Yes, go ahead.', { approve: id });
  };
  const acceptMissionOffer = (index: number) => {
    const m = messages[index];
    if (!m?.id || isStreaming) return;
    setCardResolved(index, 'applied');
    const label = m.action_payload?.label;
    void sendMessage(`Yes, make it a mission${label ? ` that runs ${label}` : ''}.`, { acceptOffer: m.id });
  };
  const declineCard = (index: number) => {
    const id = messages[index]?.id;
    setCardResolved(index, 'skipped');
    if (id) {
      fetch('/api/chat-messages/resolve', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: id, outcome: 'skipped' }),
      }).catch(() => { /* shown as declined here; may show again after a reload */ });
    }
  };

  // ── Apply action card ──────────────────────────────────────────────────────
  const applyAction = async (action: ActionPayload, msgIndex: number) => {
    setApplyingAction(msgIndex);
    if (ONE_SHOT_ACTIONS.has(action.type)) markCardUsed(msgIndex);
    try {
      const mission = { id: action.missionId, title: action.missionTitle };
      // Pause / resume / remove schedule: one request, its result kept in the chat.
      const patchMission = (kind: ResultKind, label: string, body: Record<string, unknown>, detail: string) =>
        runInChat(kind, label, mission, async () => {
          const res = await fetch(`/api/missions/${action.missionId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (res.ok) return { ok: true, detail };
          const err = await res.json().catch(() => ({})) as { error?: string };
          return { ok: false, error: err.error ?? 'The request was not accepted.' };
        }, action);

      if (action.type === 'run_mission' && action.missionId) {
        const ep = action.missionStatus === 'draft'
          ? `/api/missions/${action.missionId}/run`
          : `/api/missions/${action.missionId}/execute`;
        const res = await fetch(ep, { method: 'POST', credentials: 'include' });
        const data = await res.json().catch(() => ({})) as { runId?: string; error?: string; message?: string; code?: string };
        if (data.runId && (res.ok || (res.status === 409 && data.code === 'run_in_progress'))) {
          // Started — or already going / waiting for an approval: its card says where it is.
          followRun(action.missionId, data.runId, action.missionTitle);
        } else if (!res.ok) {
          await runInChat('run', action.missionTitle || 'Run this mission', mission, async () => ({ ok: false, error: data.message ?? data.error ?? 'The run could not be started.' }), action);
        }

      } else if (action.type === 'schedule_mission' && action.missionId && action.cron) {
        const cron = action.cron;
        const timezone = action.timezone ?? 'Asia/Kolkata';
        await runInChat('schedule', action.label || cron, mission, async () => {
          const res = await fetch(`/api/missions/${action.missionId}`, {
            method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'schedule', scheduleConfig: { cron, timezone } }),
          });
          if (res.ok) return { ok: true, detail: describeNextRun(cron, timezone) };
          const err = await res.json().catch(() => ({})) as { error?: string };
          return { ok: false, error: err.error ?? 'Could not set the schedule.' };
        }, action);

      } else if (action.type === 'pause_mission' && action.missionId) {
        await patchMission('pause', action.missionTitle || 'This mission', { action: 'pause' }, 'Scheduled runs are on hold until you resume it.');

      } else if (action.type === 'unschedule_mission' && action.missionId) {
        await patchMission('unschedule', action.missionTitle || 'This mission', { action: 'unschedule' }, 'It now runs only when you start it.');

      } else if (action.type === 'resume_mission' && action.missionId) {
        await patchMission('resume', action.missionTitle || 'This mission', { action: 'resume' }, 'Scheduled runs continue.');

      } else if (action.type === 'suggest_connector' && action.provider) {
        // Connected right here, in a sign-in window: leaving for the Connectors page lost the conversation.
        continueAfterConnectRef.current = action.provider;
        await handleConnectInChat(action.provider);

      } else if (action.type === 'open_mission' && action.missionId) {
        router.push(`/dashboard/missions/${action.missionId}`);

      } else if (action.type === 'show_missions') {
        router.push('/dashboard/missions');

      } else if (action.type === 'mission_created' && action.missionId) {
        router.push(`/dashboard/missions/${action.missionId}`);

      } else if (action.type === 'show_usage') {
        router.push('/dashboard/usage');
      }
    } catch {
      await runInChat('run', action.label || action.missionTitle || 'This action', { id: action.missionId, title: action.missionTitle }, async () => ({ ok: false, error: 'Something went wrong. Please try again.' }), action);
    }
    setApplyingAction(null);
  };

  // ── Voice input ────────────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) fileInputRef.current = e.target;
    e.target.value = '';
    if (!file) return;
    setPendingFile({ name: file.name, uploading: true });
    try {
      const fd = new FormData();
      fd.append('file', file);
      // No missionId for Command Center — platform-level asset
      const res = await fetch('/api/upload-file', { method: 'POST', credentials: 'include', body: fd });
      const data = await res.json() as { success?: boolean; assetId?: string; error?: string };
      if (!res.ok || !data.success) {
        setPendingFile({ name: file.name, uploading: false, error: data.error ?? 'Upload failed' });
      } else {
        setPendingFile({ name: file.name, assetId: data.assetId, uploading: false });
      }
    } catch {
      setPendingFile({ name: file.name, uploading: false, error: 'Upload failed' });
    }
  };

  const toggleVoice = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop(); setIsRecording(false); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); audioChunksRef.current = [];
      mr.ondataavailable = e => audioChunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        // Safari records mp4, Chrome webm: send the real type, the server names the file from it.
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' });
        const fd = new FormData(); fd.append('audio', blob, 'recording');
        try {
          const res = await fetch('/api/whisper/transcribe', { method: 'POST', credentials: 'include', body: fd });
          if (res.ok) { const d = await res.json() as { text?: string }; if (d.text) setInput(prev => (prev + ' ' + d.text).trim()); }
        } catch { /* non-fatal */ }
      };
      mr.start(); mediaRecorderRef.current = mr; setIsRecording(true);
    } catch { showToast('Microphone access denied.'); }
  };

  // ── Action Card Renderer ───────────────────────────────────────────────────
  // ── Processing card (shown while server builds the action result) ─────────────
  const renderProcessingCard = (actionType: string, liveStep?: string, progress?: BuildProgress) => {
    type CfgEntry = { icon: string; title: string; sub: string; steps?: string[] };
    const cfg: Record<string, CfgEntry> = {
      create_mission: {
        icon: '✨', title: 'Building Mission Blueprint',
        sub: 'Designing your agent pipeline…',
        steps: ['Structuring agent roles & capabilities', 'Wiring tool connections', 'Verifying required connectors'],
      },
      run_mission:      { icon: '▶',  title: 'Launching Mission',    sub: 'Dispatching your agents…' },
      schedule_mission: { icon: '📅', title: 'Applying Schedule',     sub: 'Configuring run timing…' },
      pause_mission:    { icon: '⏸',  title: 'Pausing Mission',       sub: 'Halting scheduled runs…' },
      resume_mission:   { icon: '▶',  title: 'Resuming Mission',      sub: 'Re-enabling the schedule…' },
      unschedule_mission:{ icon: '🗑', title: 'Removing Schedule',     sub: 'Stopping recurring runs…' },
      suggest_connector:{ icon: '🔗', title: 'Checking Connector',    sub: 'Looking up integration details…' },
      pending:          { icon: '⟳',  title: 'Processing',            sub: 'One moment…' },
    };
    const c: CfgEntry = cfg[actionType] ?? cfg.pending;
    const displaySub = liveStep ?? c.sub;

    return (
      <div style={{ marginTop: 10, maxWidth: 520, animation: 'slideIn 0.3s ease', fontFamily: 'var(--font-sans)' }}>
        <div style={{
          background: 'var(--bg-card)', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
          borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: 'var(--accent-subtle)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.9rem', animation: 'pulse 1.5s ease-in-out infinite',
            }}><Glyph e={c.icon} size={16} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>{c.title}</div>
              <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: 2 }}>{displaySub}</div>
            </div>
            {/* Bouncing dots */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                  animation: `af-dot 1.2s ease-in-out ${i * 0.18}s infinite`,
                }} />
              ))}
            </div>
          </div>

          {/* Indeterminate progress bar */}
          <div style={{ position: 'relative', height: 3, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', top: 0, height: '100%',
              background: 'linear-gradient(90deg,var(--accent),var(--purple))',
              borderRadius: 99, animation: 'af-bar 1.6s cubic-bezier(0.4,0,0.6,1) infinite',
            }} />
          </div>

          {/* Each agent's code, written in its own step */}
          {progress && progress.roles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }} aria-label="Writing each agent's code">
              {progress.roles.map((role, i) => {
                const ready = progress.ready.includes(role);
                return (
                  <div key={`${role}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background: ready ? 'var(--emerald)' : 'var(--accent)',
                      animation: ready ? undefined : 'pulse 1s ease-in-out infinite',
                    }} />
                    <div style={{ fontSize: '0.67rem', fontWeight: ready ? 400 : 600, color: ready ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                      {ready ? `Code ready · ${role}` : `Writing code · ${role}`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Steps during initial streaming (before Inngest sends real updates) */}
          {!liveStep && c.steps && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {c.steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: i === 0 ? 'var(--accent)' : 'var(--border)',
                    animation: i === 0 ? 'pulse 1s ease-in-out infinite' : undefined,
                  }} />
                  <div style={{
                    fontSize: '0.67rem', fontWeight: i === 0 ? 600 : 400,
                    color: i === 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                    opacity: i === 0 ? 1 : 0.5,
                  }}>{step}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderActionCard = (action: ActionPayload, msgIndex: number) => {
    const applying = applyingAction === msgIndex;
    const used = !!messages[msgIndex]?.action_applied;
    const usedNote = <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--emerald)' }}>✓ Applied</div>;
    const btnStyle: React.CSSProperties = {
      background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: 'var(--radius-sm)',
      padding: '6px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: applying ? 'not-allowed' : 'pointer',
      opacity: applying ? 0.6 : 1,
    };
    const ghostBtn: React.CSSProperties = { ...btnStyle, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' };
    const card: React.CSSProperties = { marginTop: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 };

    if (action.type === 'run_mission') return (
      <div style={card}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}><Glyph e="▶" /> Run "{action.missionTitle}"</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {used ? usedNote : <button style={btnStyle} onClick={() => applyAction(action, msgIndex)} disabled={applying}>{applying ? 'Starting…' : 'Run Now'}</button>}
          <button style={ghostBtn} onClick={() => router.push(`/dashboard/missions/${action.missionId}/chat`)}>Open mission</button>
        </div>
      </div>
    );

    if (action.type === 'open_mission') return (
      <div style={card}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{action.missionTitle}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnStyle} onClick={() => router.push(`/dashboard/missions/${action.missionId}/chat`)}>Open Chat</button>
          <button style={ghostBtn} onClick={() => router.push(`/dashboard/missions/${action.missionId}`)}>View Mission</button>
        </div>
      </div>
    );

    if (action.type === 'schedule_mission') return (
      <div style={card}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600 }}><Glyph e="📅" /> Schedule "{action.missionTitle}"</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{action.label ?? action.cron}</div>
        {used ? usedNote : <button style={{ ...btnStyle, alignSelf: 'flex-start' }} onClick={() => applyAction(action, msgIndex)} disabled={applying}>{applying ? 'Applying…' : 'Apply Schedule'}</button>}
      </div>
    );

    if (action.type === 'pause_mission' || action.type === 'resume_mission' || action.type === 'unschedule_mission') return (
      <div style={card}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{action.type === 'pause_mission' ? 'Pause' : action.type === 'unschedule_mission' ? 'Remove schedule for' : 'Resume'} "{action.missionTitle}"</div>
        {used ? usedNote : <button style={{ ...btnStyle, alignSelf: 'flex-start' }} onClick={() => applyAction(action, msgIndex)} disabled={applying}>{applying ? 'Working…' : 'Confirm'}</button>}
      </div>
    );

    // A one-time job's steps in the customer's apps: done only after "Do it"; sending, posting and
    // deleting go out exactly as shown here.
    if (action.type === 'confirm_app_actions') {
      const steps = action.steps ?? [];
      const decided = used || !!action.resolved;
      return (
        <div style={{ ...card, maxWidth: 520 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{action.summary}</div>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <ConnectorLogo id={s.toolkit} size={14} /> {s.what}
                </span>
                {s.exact && s.preview && s.preview.length > 0 && (
                  <div style={{ marginTop: 5, padding: '7px 9px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {s.preview.map(p => (
                      <div key={p.label} style={{ fontSize: '0.72rem', lineHeight: 1.45 }}>
                        <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{p.label}: </span>
                        <span style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{p.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {decided ? (
            <div style={{ fontSize: '0.74rem', fontWeight: 600, color: action.resolved === 'skipped' ? 'var(--text-muted)' : 'var(--emerald)' }}>
              {action.resolved === 'skipped' ? 'Not done' : '✓ Approved'}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnStyle} disabled={isStreaming} onClick={() => approvePlan(msgIndex)}>Do it</button>
                <button style={ghostBtn} disabled={isStreaming} onClick={() => declineCard(msgIndex)}>Not now</button>
              </div>
              {steps.some(s => s.exact) && (
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Messages go out exactly as shown.</div>
              )}
            </>
          )}
        </div>
      );
    }

    // After a one-time job they'll likely need again: make it a mission that runs by itself.
    if (action.type === 'offer_mission') {
      const decided = used || !!action.resolved;
      return (
        <div style={card}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            <Glyph e="🔁" /> Make this a mission{action.label ? ` that runs ${action.label}` : ''}?
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            It happens by itself, so you don&apos;t have to ask each time. You&apos;ll see its plan before anything runs.
          </div>
          {decided ? (
            <div style={{ fontSize: '0.74rem', fontWeight: 600, color: action.resolved === 'skipped' ? 'var(--text-muted)' : 'var(--emerald)' }}>
              {action.resolved === 'skipped' ? 'Not now' : '✓ Making it a mission'}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btnStyle} disabled={isStreaming} onClick={() => acceptMissionOffer(msgIndex)}>Yes, make it a mission</button>
              <button style={ghostBtn} disabled={isStreaming} onClick={() => declineCard(msgIndex)}>No thanks</button>
            </div>
          )}
        </div>
      );
    }

    if (action.type === 'suggest_connector') {
      const slug = action.provider ?? '';
      const connected = connectedInSession.has(slug);
      return (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', fontWeight: 600 }}>
            <span style={{ display: 'inline-flex' }}><ConnectorLogo id={slug} size={18} /></span> Connect <AppName slug={slug} />
          </div>
          {action.reason && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{action.reason}</div>}
          {connected
            ? <span style={{ alignSelf: 'flex-start', fontSize: '0.72rem', fontWeight: 700, color: 'var(--emerald)' }}>✓ Connected</span>
            : <button style={{ ...btnStyle, alignSelf: 'flex-start' }} onClick={() => { continueAfterConnectRef.current = slug; void handleConnectInChat(slug); }} disabled={connectingSlug === slug}>
                {connectingSlug === slug ? 'Connecting…' : APIKEY_CONNECTORS.has(slug) ? 'Add API key' : 'Connect →'}
              </button>}
        </div>
      );
    }

    if (action.type === 'building_blueprint' && action.jobId) {
      const liveStep = blueprintSteps[action.jobId];
      const isActive = blueprintPollsRef.current.has(action.jobId);
      if (isActive || liveStep) {
        return renderProcessingCard('create_mission', liveStep, blueprintProgress[action.jobId]);
      }
      // Historical message — job is no longer active
      return (
        <div style={card}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}><Glyph e="✨" /> Blueprint job has ended. Check your Missions list.</div>
          <button style={ghostBtn} onClick={() => router.push('/dashboard/missions')}>View Missions →</button>
        </div>
      );
    }

    if (action.type === 'mission_created') {
      const agents: AgentCard[] = action.agents ?? [];
      const patternLabel: Record<string, string> = {
        sequential: 'Sequential', parallel: 'Parallel',
        orchestrator_worker: 'Orchestrator + Workers', hierarchical: 'Hierarchical',
      };
      const agentAccent = (icon?: string): string => ({
        '🧠': 'var(--accent)', '🎨': 'var(--purple)', '📲': 'var(--emerald)', '📧': 'var(--amber)',
        '🎬': 'var(--rose)', '🔍': 'var(--info)', '📊': 'var(--purple)', '🎯': 'var(--amber)',
        '🔔': 'var(--purple)',
      }[icon ?? ''] ?? 'var(--text-muted)');

      return (
        <div style={{ marginTop: 14, maxWidth: 520, animation: 'slideIn 0.3s ease', fontFamily: 'var(--font-sans)' }}>

          {/* ── Blueprint Header ── */}
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderBottom: 'none', borderRadius: '14px 14px 0 0',
            padding: '12px 16px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                background: 'linear-gradient(135deg,var(--accent),var(--purple))',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem',
              }}><Glyph e="✨" /></div>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>Mission Blueprint Ready</div>
                <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: 1 }}>
                  {action.missionTitle}{typeof action.credits === 'number' && action.credits > 0 ? ` · built for ${action.credits} credits` : ''}
                </div>
              </div>
            </div>
            {action.orchestrationPattern && (
              <div style={{
                fontSize: '0.58rem', fontWeight: 800, color: 'var(--accent)',
                background: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                borderRadius: 99, padding: '3px 10px', textTransform: 'uppercase',
                letterSpacing: '0.6px', flexShrink: 0,
              }}>
                {patternLabel[action.orchestrationPattern] ?? action.orchestrationPattern}
              </div>
            )}
          </div>

          {/* ── Pipeline Canvas ── */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
            padding: '14px 14px 10px',
          }}>

            {/* Trigger Node */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--bg-card)',
              border: '1px solid color-mix(in srgb, var(--amber) 35%, transparent)',
              borderLeft: '3px solid var(--amber)',
              borderRadius: 10, padding: '10px 12px',
              boxShadow: '0 0 0 3px color-mix(in srgb, var(--amber) 5%, transparent)',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: 'color-mix(in srgb, var(--amber) 12%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
              }}><Glyph e="⏰" /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.59rem', fontWeight: 800, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>Entry Point · Trigger</div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>Scheduled + Manual Run</div>
              </div>
              <div style={{
                fontSize: '0.59rem', fontWeight: 800, color: 'var(--amber)',
                background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 25%, transparent)',
                borderRadius: 99, padding: '2px 8px', letterSpacing: '0.4px',
              }}>ACTIVE</div>
            </div>

            {/* Agents with connectors */}
            {agents.length > 0 ? agents.map((agent, i) => {
              const accent = agentAccent(agent.icon);
              return (
                <React.Fragment key={i}>
                  {/* Flow connector */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 auto', width: 'fit-content', marginLeft: 'calc(14px + 18px)' }}>
                    <div style={{ width: 2, height: 10, background: `linear-gradient(to bottom,${accent}99,${accent}44)` }} />
                    <svg width="12" height="7" viewBox="0 0 12 7" style={{ display: 'block' }}>
                      <path d="M6 7 L0 0 L12 0 Z" fill={accent} fillOpacity="0.65" />
                    </svg>
                    <div style={{ width: 2, height: 6, background: `${accent}33` }} />
                  </div>

                  {/* Agent Card */}
                  <div style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderLeft: `3px solid ${accent}`,
                    borderRadius: 10, padding: '10px 12px',
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    boxShadow: `0 0 0 3px ${accent}0a`,
                  }}>
                    {/* Number badge */}
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 3,
                      background: accent, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.65rem', fontWeight: 800,
                    }}>{i + 1}</div>

                    {/* Role icon */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: `${accent}18`, border: `1px solid ${accent}35`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
                    }}><Glyph e={agent.icon ?? '🤖'} size={18} /></div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{agent.name}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>{agent.role}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                        {agent.tool && (
                          <span style={{
                            fontSize: '0.59rem', fontWeight: 700, padding: '2px 8px',
                            background: `${accent}18`, color: accent,
                            border: `1px solid ${accent}35`, borderRadius: 99, letterSpacing: '0.3px',
                          }}>{agent.tool}</span>
                        )}
                        {agent.trustLevel && (
                          <span style={{
                            fontSize: '0.59rem', fontWeight: 700, padding: '2px 8px',
                            background: 'var(--bg-secondary)', color: 'var(--text-muted)',
                            border: '1px solid var(--border)', borderRadius: 99, letterSpacing: '0.3px',
                          }}>{agent.trustLevel.toUpperCase()}</span>
                        )}
                      </div>
                    </div>

                    {/* Status */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0, paddingTop: 2 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-muted)', opacity: 0.35 }} />
                      <div style={{ fontSize: '0.52rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Idle</div>
                    </div>
                  </div>
                </React.Fragment>
              );
            }) : (
              <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: 4 }}>
                Agents will appear here after the mission is configured.
              </div>
            )}
          </div>

          {/* ── Required Connectors Section ── */}
          {action.requiredConnectors !== undefined && (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderTop: action.requiredConnectors.some(c => !c.connected && !connectedInSession.has(c.service))
                ? '1px solid color-mix(in srgb, var(--rose) 18%, transparent)'
                : '1px solid color-mix(in srgb, var(--emerald) 20%, transparent)',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: '0.59rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
                Required Connectors
              </div>

              {action.requiredConnectors.length === 0 || action.requiredConnectors.every(c => c.connected || connectedInSession.has(c.service)) ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.78rem', color: 'var(--emerald)', fontWeight: 600 }}>
                  <span><Glyph e="✅" /></span> All connectors ready — you can run now
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {action.requiredConnectors.map((c, idx) => {
                    const isConnected = c.connected || connectedInSession.has(c.service);
                    const isConnectingThis = connectingSlug === c.service;
                    const isApiKey = APIKEY_CONNECTORS.has(c.service);
                    return (
                      <div key={idx} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: 8,
                        background: isConnected ? 'color-mix(in srgb, var(--emerald) 5%, transparent)' : 'color-mix(in srgb, var(--rose) 4%, transparent)',
                        border: `1px solid ${isConnected ? 'color-mix(in srgb, var(--emerald) 20%, transparent)' : 'color-mix(in srgb, var(--rose) 13%, transparent)'}`,
                      }}>
                        <span style={{ flexShrink: 0, display: 'inline-flex' }}><ConnectorLogo id={c.service} size={20} /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}><AppName slug={c.service} /></div>
                          <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.reason}</div>
                        </div>
                        {isConnected ? (
                          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--emerald)', background: 'color-mix(in srgb, var(--emerald) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--emerald) 30%, transparent)', borderRadius: 99, padding: '2px 10px', flexShrink: 0 }}>✓ Connected</span>
                        ) : (
                          <button
                            onClick={() => handleConnectInChat(c.service)}
                            disabled={isConnectingThis}
                            style={{
                              background: isApiKey ? 'color-mix(in srgb, var(--amber) 8%, transparent)' : 'color-mix(in srgb, var(--accent) 8%, transparent)',
                              border: `1px solid ${isApiKey ? 'color-mix(in srgb, var(--amber) 30%, transparent)' : 'color-mix(in srgb, var(--accent) 30%, transparent)'}`,
                              color: isApiKey ? 'var(--amber)' : 'var(--accent)',
                              borderRadius: 6, padding: '4px 12px',
                              fontSize: '0.7rem', fontWeight: 700,
                              cursor: isConnectingThis ? 'not-allowed' : 'pointer',
                              flexShrink: 0, fontFamily: 'var(--font-sans)',
                              opacity: isConnectingThis ? 0.6 : 1,
                            }}
                          >
                            {isConnectingThis ? 'Connecting…' : isApiKey ? 'Add API key' : 'Connect →'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {action.requiredConnectors.some(c => !c.connected && !connectedInSession.has(c.service)) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.67rem', color: 'var(--amber)', marginTop: 2 }}>
                      <span><Glyph e="⚠️" /></span> Connect the above before running this mission
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Action Buttons ── */}
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderTop: 'none', borderRadius: '0 0 14px 14px',
            padding: '12px 14px', display: 'flex', gap: 8, flexWrap: 'wrap',
          }}>
            {action.movedToChat && (
              <button
                type="button"
                onClick={() => router.push(`/dashboard/missions/${action.missionId}/chat`)}
                style={{ flexBasis: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0 0 4px', fontSize: '0.74rem', fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
              >
                This conversation continues in the mission chat →
              </button>
            )}
            <button
              style={{
                flex: 2, padding: '9px 0', borderRadius: 8,
                background: 'linear-gradient(135deg,var(--accent),var(--purple))', color: 'var(--on-accent)',
                border: 'none', fontSize: '0.82rem', fontWeight: 700,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
              onClick={() => router.push(`/dashboard/missions/${action.missionId}`)}
            >
              Open Mission →
            </button>
            <button
              style={{
                flex: 1, padding: '9px 0', borderRadius: 8,
                background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', fontSize: '0.78rem', fontWeight: 600,
                cursor: applying ? 'not-allowed' : 'pointer', opacity: applying ? 0.6 : 1,
                fontFamily: 'var(--font-sans)',
              }}
              onClick={() => applyAction({ type: 'run_mission', missionId: action.missionId, missionTitle: action.missionTitle, missionStatus: 'active' }, msgIndex)}
              disabled={applying}
            >
              {applying ? 'Starting…' : 'Run'}
            </button>
          </div>
        </div>
      );
    }

    if (action.type === 'show_missions') return (
      <div style={card}>
        <button style={{ ...btnStyle, alignSelf: 'flex-start' }} onClick={() => router.push('/dashboard/missions')}>View All Missions →</button>
      </div>
    );

    if (action.type === 'show_usage') return (
      <div style={card}>
        <button style={{ ...btnStyle, alignSelf: 'flex-start' }} onClick={() => router.push('/dashboard/usage')}>View Usage & Credits →</button>
      </div>
    );

    if (action.type === 'blueprint_question') return (
      <div style={card}>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}><Glyph e="💬" /> Reply below and the mission will be built with your answer.</div>
      </div>
    );

    if (action.type === 'mission_create_error') return (
      <div style={{ ...card, borderColor: 'var(--red,var(--rose))' }} role="alert">
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--red,var(--rose))' }}><Glyph e="⚠️" /> Could not create the mission</div>
        {action.error && <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{action.error}</div>}
        {typeof action.credits === 'number' && action.credits > 0 && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Charged {action.credits} credits, at the reduced rate for failed builds.</div>
        )}
        <button style={{ ...ghostBtn, alignSelf: 'flex-start' }} disabled={applying} onClick={() => retryBuild(action.jobId, msgIndex)}>
          {applying ? 'Starting again…' : 'Try again'}
        </button>
      </div>
    );

    if (action.type === 'key_connected') {
      return (
        <div style={{ ...card, borderColor: 'color-mix(in srgb, var(--emerald) 35%, transparent)', background: 'color-mix(in srgb, var(--emerald) 4%, transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ lineHeight: 1, display: 'inline-flex' }}><ConnectorLogo id={action.provider ?? ''} size={26} /></span>
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emerald)' }}><Glyph e="✅" /> <AppName slug={action.provider ?? ''} /> Connected</div>
              {action.accountInfo && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{action.accountInfo}</div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (action.type === 'key_connection_failed') {
      return (
        <div style={{ ...card, borderColor: 'color-mix(in srgb, var(--rose) 30%, transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ lineHeight: 1, display: 'inline-flex' }}><ConnectorLogo id={action.provider ?? ''} size={22} /></span>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--rose)' }}><Glyph e="❌" /> <AppName slug={action.provider ?? ''} /> key not valid</div>
          </div>
          {action.error && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{action.error}</div>}
          <button
            style={{ ...ghostBtn, alignSelf: 'flex-start' }}
            onClick={() => {
              setInlineApiKeyValue(''); setInlineApiKeyError(null);
              setInlineApiKeySuccess(false); setInlineApiKeyModal({ service: action.provider ?? '' });
            }}
          >
            Try Again →
          </button>
        </div>
      );
    }

    return null;
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Onboarding tour — shown once on first login */}
      <OnboardingTour />

      {/* ── Inline API Key Modal (connect from blueprint card without leaving chat) ── */}
      {inlineApiKeyModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}
          onClick={() => setInlineApiKeyModal(null)}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, width: '100%', maxWidth: 420, padding: '20px 22px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ display: 'inline-flex' }}><ConnectorLogo id={inlineApiKeyModal.service} size={24} /></span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Connect <AppName slug={inlineApiKeyModal.service} /></div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>API Key · encrypted at rest</div>
                </div>
              </div>
              <button onClick={() => setInlineApiKeyModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1, padding: 4 }}>✕</button>
            </div>

            {inlineApiKeySuccess ? (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}><Glyph e="✅" /></div>
                <div style={{ fontWeight: 700, color: 'var(--emerald)' }}><AppName slug={inlineApiKeyModal.service} /> Connected!</div>
              </div>
            ) : (
              <>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  {API_KEY_FIELD_LABELS[inlineApiKeyModal.service] ?? 'API Key'}
                </label>
                <input
                  type="password" autoComplete="new-password"
                  placeholder={`Paste your ${connectorMeta(inlineApiKeyModal.service).label} API key`}
                  value={inlineApiKeyValue}
                  onChange={e => setInlineApiKeyValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !inlineApiKeySaving && handleInlineApiKeySave()}
                  disabled={inlineApiKeySaving}
                  style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: '0.85rem', color: 'var(--text-primary)', fontFamily: 'monospace', marginBottom: 10, boxSizing: 'border-box' }}
                />
                {inlineApiKeyError && (
                  <div style={{ padding: '8px 12px', background: 'color-mix(in srgb, var(--rose) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--rose) 20%, transparent)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--rose)', marginBottom: 10 }}>
                    <Glyph e="❌" /> {inlineApiKeyError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setInlineApiKeyModal(null)} disabled={inlineApiKeySaving}
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>
                    Cancel
                  </button>
                  <button onClick={handleInlineApiKeySave} disabled={inlineApiKeySaving || !inlineApiKeyValue.trim()}
                    style={{ background: 'linear-gradient(135deg,var(--accent),var(--purple))', color: 'var(--on-accent)', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: '0.82rem', fontWeight: 700, cursor: inlineApiKeySaving || !inlineApiKeyValue.trim() ? 'not-allowed' : 'pointer', opacity: inlineApiKeySaving || !inlineApiKeyValue.trim() ? 0.6 : 1, fontFamily: 'var(--font-sans)' }}>
                    {inlineApiKeySaving ? 'Saving…' : 'Save & Connect →'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9998, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)', animation: 'slideIn 0.2s ease' }}>
          {toast}
        </div>
      )}

      {/* Full-screen layout pinned past the app sidebar */}
      <div className="cc-container" style={{ position: 'fixed', top: 0, left: 'var(--sidebar-width, 260px)', right: 0, bottom: 0, display: 'flex', background: 'var(--bg-primary)', zIndex: 40, fontFamily: 'var(--font-sans)' }}>

        {/* ── Missions Sidebar ───────────────────────────────────────────── */}
        <MissionsSidebar activeChatId={activeSessionId} chatsVersion={chatsVersion} />

        {/* ── Main Chat Area ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0, flexWrap: 'nowrap', minHeight: 52 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Command Center</div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>Your AI Chief of Staff</div>
            </div>
            {(activeSessionId || messages.length > 0) && (
              <button onClick={startNewChat} disabled={isStreaming} className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', flexShrink: 0, whiteSpace: 'nowrap' }}>New chat</button>
            )}
            <button onClick={() => { setInput('Create a new mission: '); inputRef.current?.focus(); }} className="btn btn-primary btn-sm" style={{ fontSize: '0.75rem', flexShrink: 0, whiteSpace: 'nowrap' }}>+ New Mission</button>
          </div>

          {/* Live run strip — the run started from here, same view as its card in the chat */}
          {/* Everything waiting on your OK, across missions — decided right here */}
          <PendingApprovals onDecided={(record, a) => addApprovalRecord(record, a.missionId, a.missionTitle)} />

          {trackedMissionId && (
            <RunStrip
              missionId={trackedMissionId}
              onView={() => { const cards = document.querySelectorAll('[data-run-card]'); cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
            />
          )}


          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
            <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Welcome state — shown whenever the conversation is empty */}
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', padding: '56px 20px 48px' }}>
                  <div style={{ display: 'inline-flex', marginBottom: 24 }}><LogoMark size={30} shape="wide" title="Agentic Factor" /></div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2.4rem', fontWeight: 400, lineHeight: 1.08, letterSpacing: '-0.01em', color: 'var(--text-primary)', marginBottom: 14 }}>
                    What shall we automate today?
                  </h2>
                  {welcomeMessage && (
                    <div style={{
                      maxWidth: 520, margin: '0 auto 28px',
                      padding: '14px 20px',
                      background: 'var(--accent-subtle)',
                      border: '1px solid color-mix(in srgb, var(--emerald) 18%, transparent)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '0.86rem',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.75,
                      fontStyle: 'italic',
                    }}>
                      {welcomeMessage}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {QUICK_CHIPS.map(chip => (
                      <button key={chip} onClick={() => sendMessage(chip)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: '7px 16px', fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text-secondary)', transition: 'all 0.15s' }}>
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chat messages */}
              {messages.map((msg, i) => {
                // Runs, approvals and button results — added here, or saved in this conversation's history.
                const kind = entryType(msg.action_payload);
                const saved = msg.action_payload as unknown as { runId?: string; missionId?: string; missionTitle?: string } | undefined;
                const run = msg.run ?? (kind === 'run_card' && saved?.runId && saved.missionId ? { runId: saved.runId, missionId: saved.missionId } : null);
                const approval = msg.approval ?? (kind === 'approval_record' && saved?.missionId
                  ? { record: msg.action_payload as unknown as ApprovalRecordPayload, missionId: saved.missionId, missionTitle: saved.missionTitle }
                  : null);
                if (run) return (
                  <div key={i} data-run-card={run.runId} style={{ maxWidth: 520, width: '100%' }}>
                    <LiveRunCard compact missionId={run.missionId} runId={run.runId} onDecided={record => addApprovalRecord(record, run.missionId)} />
                  </div>
                );
                if (approval) return (
                  <div key={i} style={{ maxWidth: 520, width: '100%' }}>
                    <ApprovalRecord record={approval.record} missionId={approval.missionId} missionTitle={approval.missionTitle} />
                  </div>
                );
                if (msg.pendingResult) return (
                  <div key={i} style={{ maxWidth: 520, width: '100%' }}>
                    <PendingResult kind={msg.pendingResult.kind} label={msg.pendingResult.label} />
                  </div>
                );
                if (kind === 'action_result') {
                  const entry = msg.action_payload as unknown as ActionResultEntry;
                  const retry = entry.action as ActionPayload | undefined;
                  return (
                    <div key={i} style={{ maxWidth: 520, width: '100%' }}>
                      <ActionResult entry={entry} showMission onRetry={retry?.type ? () => applyAction(retry, -1) : undefined} />
                    </div>
                  );
                }
                return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '82%',
                    background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-card)',
                    color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                    borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    padding: '10px 16px', fontSize: '0.88rem', lineHeight: 1.65,
                    border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                  }}>
                    {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                    {msg.isStreaming && !msg.processingAction && <span style={{ display: 'inline-block', width: 8, height: 16, background: 'var(--accent)', marginLeft: 3, borderRadius: 2, animation: 'pulse 1s infinite', verticalAlign: 'text-bottom' }} />}
                  </div>
                  {msg.role === 'assistant' && msg.isStreaming && msg.processingAction && renderProcessingCard(msg.processingAction)}
                  {msg.role === 'assistant' && msg.action_payload && !msg.isStreaming && renderActionCard(msg.action_payload as ActionPayload, i)}
                </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Quick chips when conversation is active */}
          {messages.length > 0 && !isStreaming && (
            <div style={{ padding: '0 20px 8px', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 780, margin: '0 auto', width: '100%' }}>
              {QUICK_CHIPS.map(chip => (
                <button key={chip} onClick={() => sendMessage(chip)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 12px', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-muted)' }}>
                  {chip}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
            <div style={{ maxWidth: 780, margin: '0 auto' }}>
              {/* File attachment chip */}
              {pendingFile && (
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 10px 4px 8px', fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '100%' }}>
                    <span style={{ display: 'inline-flex' }}><Glyph e={pendingFile.uploading ? '⏳' : pendingFile.error ? '⚠️' : '📎'} size={14} /></span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{pendingFile.name}</span>
                    {pendingFile.uploading && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>uploading…</span>}
                    {pendingFile.error && <span style={{ color: 'var(--rose)', fontSize: '0.75rem' }}>{pendingFile.error}</span>}
                    {!pendingFile.uploading && (
                      <button onClick={() => setPendingFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1, padding: '0 2px' }}>✕</button>
                    )}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                {/* Hidden file input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="*/*"
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />
                {/* Paperclip button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isStreaming || (!!pendingFile && pendingFile.uploading)}
                  title="Attach a file"
                  style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: isStreaming ? 0.4 : 1, transition: 'all 0.15s' }}
                ><Glyph e="📎" /></button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                  placeholder="Ask anything or give a command…"
                  rows={1}
                  style={{ flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '0.88rem', color: 'var(--text-primary)', resize: 'none', outline: 'none', fontFamily: 'var(--font-sans)', lineHeight: 1.55, minHeight: 42, maxHeight: 140, transition: 'border-color 0.15s' }}
                  disabled={isStreaming}
                />
                <button
                  onClick={toggleVoice}
                  style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 'var(--radius-sm)', background: isRecording ? 'var(--rose)' : 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', animation: isRecording ? 'pulse 1s infinite' : 'none' }}
                  title="Voice input"
                ><Glyph e="🎤" /></button>
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isStreaming}
                  style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 'var(--radius-sm)', background: input.trim() && !isStreaming ? 'var(--accent)' : 'var(--bg-card)', border: '1px solid var(--border)', cursor: input.trim() && !isStreaming ? 'pointer' : 'not-allowed', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: input.trim() && !isStreaming ? 1 : 0.4, transition: 'all 0.15s' }}
                >↑</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Suspense wrapper required for useSearchParams()
export default function CommandCenterPage() {
  return (
    <Suspense fallback={null}>
      <CommandCenterPageInner />
    </Suspense>
  );
}
