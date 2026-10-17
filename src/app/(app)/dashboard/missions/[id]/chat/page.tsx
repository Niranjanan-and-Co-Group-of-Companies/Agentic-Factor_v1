'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import type { RealtimeChannel } from '@supabase/supabase-js';
import MissionsSidebar from '@/components/MissionsSidebar';
import { renderMarkdown } from '@/lib/utils/render-markdown';
import { sanitizeTitle } from '@/lib/utils/sanitize-title';

import Glyph from "@/components/ui/Glyph";
import { LogoMark } from "@/components/brand/Logo";
import LiveRunCard, { RunStrip } from '@/components/runs/LiveRunCard';
import { kickLive, useMissionLive } from '@/components/runs/useLiveRun';
import { ApprovalRecord, recordOf, type ApprovalRecordPayload } from '@/components/runs/Approval';
import { decisionText } from '@/lib/services/approval-records';
import { AppDescription, AppName } from '@/components/apps/AppInfo';
import { ActionResult, PendingResult, entryType, type ActionResultEntry, type ResultKind } from '@/components/runs/ActionResult';
import { appNameNow } from '@/components/apps/useAppInfo';
import { describeNextRun } from '@/lib/services/cron-match';
// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatSession {
  id: string;
  title: string;
  updated_at: string;
}

interface RequiredConnector {
  service: string;
  reason: string;
  connected: boolean;
}

interface BlueprintStep {
  step: string;
  label: string;
  status: 'pending' | 'active' | 'done';
}

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  action_payload?: ActionPayload | null;
  action_applied?: boolean;
  isStreaming?: boolean;
  isAgentRunning?: boolean;
  agentError?: string;
  ts?: number;
  toolCards?: ToolCard[];
  /** A live run card for this run (added on the spot; the saved copy comes back from history). */
  runMonitor?: { runId: string };
  /** A button's action while it is being applied (replaced by its saved result). */
  pendingResult?: { kind: ResultKind; label: string };
  blueprintUpdate?: {
    jobId: string;
    steps: BlueprintStep[];
    status: 'running' | 'completed' | 'error';
    errorMessage?: string;
    versionNumber?: number | null;
  };
}

interface ActionPayload {
  type: 'schedule' | 'run_now' | 'resume_run' | 'go_live' | 'suggest_connector' | 'webhook' | 'update_mission' | 'run_selective' | 'revert_version';
  label: string;
  cron?: string;
  timezone?: string;
  provider?: string;
  summary?: string; // used by update_mission
  agents?: string[]; // used by run_selective — array of agent IDs
  executionMode?: 'sequential' | 'parallel'; // used by run_selective
  versionNumber?: number; // used by revert_version
  resolved?: 'applied' | 'skipped'; // set once the card is used, saved with the message
}

// ── ToolCallCards component ───────────────────────────────────────────────────

interface ToolCard {
  name: string;
  provider: string;
  displayName: string;
  status: 'running' | 'done' | 'error';
  label: string;
  summary?: string;
  logoUrl?: string | null;
}

// ── BlueprintUpdateCard — live step-by-step progress for mission updates ─────

const BLUEPRINT_STEP_LABELS: Record<string, string> = {
  analysing: 'Analysing change request',
  generating: 'Generating updated blueprint',
  validating_actions: 'Validating Composio actions',
  validating_params: 'Validating parameter names',
  saving: 'Saving blueprint',
};

function BlueprintUpdateCard({ update }: { update: NonNullable<ChatMessage['blueprintUpdate']> }) {
  const { steps, status, errorMessage, versionNumber } = update;
  const isFinished = status === 'completed' || status === 'error';
  const headerColor = status === 'completed' ? 'var(--emerald)'
    : status === 'error' ? 'var(--rose)'
    : 'var(--accent)';
  const headerLabel = status === 'completed' ? 'Mission updated'
    : status === 'error' ? 'Update failed'
    : 'Updating mission…';
  const headerIcon = status === 'completed' ? '✅' : status === 'error' ? '❌' : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {!isFinished && (
          <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: headerColor, display: 'inline-block', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
        )}
        {isFinished && headerIcon && <span style={{ display: 'inline-flex' }}><Glyph e={headerIcon} size={15} /></span>}
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: headerColor }}>{headerLabel}</span>
        {status === 'completed' && versionNumber && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>v{versionNumber} saved</span>
        )}
      </div>

      {status === 'error' && errorMessage && (
        <div style={{ fontSize: '0.78rem', color: 'var(--rose)', padding: '6px 10px', background: 'color-mix(in srgb, var(--rose) 8%, transparent)', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--rose) 20%, transparent)' }}>
          {errorMessage}
        </div>
      )}

      {steps.map((s) => {
        const stepColor = s.status === 'done' ? 'var(--emerald)'
          : s.status === 'active' ? 'var(--accent)'
          : 'var(--text-muted)';
        return (
          <div key={s.step} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 10px', borderRadius: 8,
            background: s.status === 'pending' ? 'transparent' : 'var(--bg-secondary)',
            border: `1px solid ${s.status === 'pending' ? 'transparent' : s.status === 'done' ? 'color-mix(in srgb, var(--emerald) 20%, transparent)' : 'var(--border)'}`,
            opacity: s.status === 'pending' ? 0.45 : 1,
            transition: 'all 0.2s',
          }}>
            <div style={{ width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {s.status === 'active' ? (
                <span style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              ) : s.status === 'done' ? (
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: stepColor }}>✓</span>
              ) : (
                <span style={{ fontSize: '0.72rem', color: stepColor }}>○</span>
              )}
            </div>
            <span style={{ fontSize: '0.79rem', color: s.status === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: s.status === 'active' ? 600 : 400 }}>
              {BLUEPRINT_STEP_LABELS[s.step] ?? s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── ToolCallCards component ───────────────────────────────────────────────────

function ToolCallCards({ cards }: { cards: ToolCard[] }) {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  if (cards.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
      {cards.map(card => {
        const isExpanded = expanded === card.name;
        const statusColor = card.status === 'done' ? 'var(--emerald)'
          : card.status === 'error' ? 'var(--rose)'
          : 'var(--accent)';
        const borderColor = card.status === 'done' ? 'color-mix(in srgb, var(--emerald) 25%, transparent)'
          : card.status === 'error' ? 'color-mix(in srgb, var(--rose) 25%, transparent)'
          : 'var(--border)';
        const leftStripe = card.status === 'done' ? 'color-mix(in srgb, var(--emerald) 70%, transparent)'
          : card.status === 'error' ? 'var(--rose)'
          : 'var(--accent)';

        return (
          <div key={card.name}>
            <div
              onClick={() => card.status !== 'running' && setExpanded(isExpanded ? null : card.name)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 8,
                background: 'var(--bg-secondary)',
                border: `1px solid ${borderColor}`,
                borderLeft: `3px solid ${leftStripe}`,
                cursor: card.status !== 'running' ? 'pointer' : 'default',
                transition: 'all 0.15s',
                userSelect: 'none',
              }}
            >
              {/* Logo */}
              {card.logoUrl ? (
                <img
                  src={card.logoUrl}
                  alt={card.provider}
                  style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'contain', flexShrink: 0 }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <span style={{
                  width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                  background: 'var(--accent)', color: 'var(--on-accent)',
                  fontSize: '0.6rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {card.provider.charAt(0).toUpperCase()}
                </span>
              )}

              {/* Status indicator */}
              {card.status === 'running' ? (
                <span style={{
                  display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                  border: `2px solid ${statusColor}`, borderTopColor: 'transparent',
                  animation: 'spin 0.7s linear infinite', flexShrink: 0,
                }} />
              ) : card.status === 'done' ? (
                <span style={{ color: statusColor, fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>✓</span>
              ) : (
                <span style={{ color: statusColor, fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>✗</span>
              )}

              {/* Label / summary */}
              <span style={{ flex: 1, fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {card.status === 'running' ? card.label : (card.summary ?? card.displayName)}
              </span>

              {/* Expand indicator */}
              {card.status !== 'running' && (
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                  {isExpanded ? '▲' : '▼'}
                </span>
              )}
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{
                margin: '2px 0 2px 3px',
                padding: '8px 12px', borderRadius: '0 0 8px 8px',
                background: 'var(--bg-secondary)',
                border: `1px solid ${borderColor}`, borderTop: 'none',
                fontSize: '0.72rem', color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono, monospace)',
              }}>
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>Action: </span>
                  {card.name}
                </div>
                {card.summary && (
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>Result: </span>
                    {card.summary}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const APIKEY_CONNECTORS = new Set([
  'openai', 'gemini', 'anthropic', 'buffer', 'sendgrid', 'twilio', 'apollo',
  'razorpay', 'elevenlabs', 'heygen', 'runwayml', 'tavily', 'custom_tavily',
  'stripe', 'bamboohr', 'firebase', 'zendesk', 'perplexity',
]);

const API_KEY_FIELD_LABELS: Record<string, string> = {
  openai: 'API Key (sk-...)',
  gemini: 'API Key (from aistudio.google.com)',
  anthropic: 'API Key (sk-ant-...)',
  buffer: 'Access Token',
  sendgrid: 'API Key (SG....)',
  twilio: 'Auth Token',
  apollo: 'API Key',
  razorpay: 'Secret Key (rzp_live_...)',
  elevenlabs: 'API Key',
  heygen: 'API Key',
  runwayml: 'API Key',
  tavily: 'API Key',
  custom_tavily: 'API Key',
  stripe: 'Secret Key (sk_live_...)',
  bamboohr: 'API Key',
  firebase: 'Service Account JSON',
  zendesk: 'API Token',
  perplexity: 'API Key (pplx-...)',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Which kind of result a chat action produces. */
const KIND_OF_ACTION: Partial<Record<ActionPayload['type'], ResultKind>> = {
  run_now: 'run', run_selective: 'run', resume_run: 'run', go_live: 'go_live', schedule: 'schedule',
  webhook: 'webhook', revert_version: 'revert', update_mission: 'update', suggest_connector: 'connect',
};

/** The run a chat message shows a card for: one added on the spot, or one saved in the history. */
function runIdOf(m: ChatMessage): string | undefined {
  if (m.runMonitor) return m.runMonitor.runId;
  const p = m.action_payload as unknown as { type?: string; runId?: string } | null | undefined;
  return p?.type === 'run_card' ? p.runId : undefined;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const API_KEY_PATTERNS: Array<{ regex: RegExp; provider: string; label: string }> = [
  { regex: /\bsk-[a-zA-Z0-9]{20,}\b/, provider: 'openai', label: 'OpenAI' },
  { regex: /\bAIza[a-zA-Z0-9_-]{35}\b/, provider: 'gemini', label: 'Gemini' },
  { regex: /\brzp_(live|test)_[a-zA-Z0-9]{14,}\b/, provider: 'razorpay', label: 'Razorpay' },
];

function detectApiKey(text: string): { provider: string; label: string; key: string } | null {
  for (const p of API_KEY_PATTERNS) {
    const m = text.match(p.regex);
    if (m) return { provider: p.provider, label: p.label, key: m[0] };
  }
  return null;
}


// Strip <action>...</action> blocks from streamed text before display
function stripActionTags(text: string): string {
  return text.replace(/<action>[\s\S]*?<\/action>/g, '').replace(/<action>[\s\S]*$/, '').trim();
}


const QUICK_CHIPS_DEFAULT = ['Run now', 'Schedule this', 'Add a connector', 'Explain the last run'];
const QUICK_CHIPS_AFTER_FAIL = ['Explain the error', 'Fix it for me', 'Run again'];
const QUICK_CHIPS_AFTER_CONNECT = ['Test with a sample run', 'What else can we add?'];


// ── Main Component ────────────────────────────────────────────────────────────

export default function MissionChatPage() {
  const { id: missionId } = useParams() as { id: string };
  const router = useRouter();

  const [missionTitle, setMissionTitle] = useState('Mission');
  const [missionStatus, setMissionStatus] = useState('draft');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [proactiveAlert, setProactiveAlert] = useState<string | null>(null);
  const [quickChips, setQuickChips] = useState<string[]>(QUICK_CHIPS_DEFAULT);
  const [detectedKey, setDetectedKey] = useState<{ provider: string; label: string; key: string } | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [applyingAction, setApplyingAction] = useState<number | null>(null);
  const [toolStatusLines, setToolStatusLines] = useState<Array<{ name: string; provider: string; displayName: string; status: 'running' | 'done' | 'error'; label: string; summary?: string; logoUrl?: string | null }>>([]);

  // ── Connector state ──────────────────────────────────────────
  const [requiredConnectors, setRequiredConnectors] = useState<RequiredConnector[]>([]);
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [connectedInSession, setConnectedInSession] = useState<Set<string>>(new Set());
  const [inlineApiKeyModal, setInlineApiKeyModal] = useState<{ slug: string; label: string } | null>(null);
  const [inlineApiKeyValue, setInlineApiKeyValue] = useState('');
  const [inlineApiKeySaving, setInlineApiKeySaving] = useState(false);
  const [inlineApiKeyError, setInlineApiKeyError] = useState<string | null>(null);

  const [pendingFile, setPendingFile] = useState<{ name: string; assetId?: string; uploading: boolean; error?: string } | null>(null);

  // ── Mission share / invite panel ─────────────────────────────
  const [shareOpen, setShareOpen] = useState(false);
  const [missionMembers, setMissionMembers] = useState<Array<{ id: string; member_email: string; role: string; status: string }>>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'collaborator' | 'viewer'>('collaborator');
  const [shareInviting, setShareInviting] = useState(false);
  const [shareResult, setShareResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Inngest / Realtime execution state
  const waitingForInngestRef = useRef(false);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  // TTS / voice-response state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastInputWasVoiceRef = useRef(false);
  const [playingMsgIdx, setPlayingMsgIdx] = useState<number | null>(null);


  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setPlayingMsgIdx(null);
  }, []);

  const speakText = useCallback(async (text: string, msgIdx: number) => {
    // Stop anything currently playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setPlayingMsgIdx(msgIdx); // show as loading/playing immediately

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text }),
      });
      if (!res.ok) { setPlayingMsgIdx(null); return; }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; setPlayingMsgIdx(null); };
      audio.onerror = () => { URL.revokeObjectURL(url); audioRef.current = null; setPlayingMsgIdx(null); };
      await audio.play();
    } catch {
      setPlayingMsgIdx(null);
    }
  }, []);

  // ── Load mission title, status, and required connectors ──────
  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;

      // Read mission_json so we can extract permissions + fallback title from it
      const { data: mission } = await supabase
        .from('missions')
        .select('title, status, mission_json')
        .eq('id', missionId)
        .eq('tenant_id', user.id)
        .single();

      const missionJson = mission?.mission_json as Record<string, unknown> | null;

      // Title: prefer missions.title column, fall back to mission_json.title
      const resolvedTitle = mission?.title || (missionJson?.title as string | undefined);
      if (resolvedTitle) setMissionTitle(sanitizeTitle(resolvedTitle));
      if (mission?.status) setMissionStatus(mission.status);

      // Permissions live inside mission_json, not a separate column
      const rawPerms = (missionJson?.permissions as Array<{ service: string; scope?: string; type?: string }> | null) ?? [];
      if (rawPerms.length === 0) return;

      // Deduplicate by service
      const seen = new Set<string>();
      const unique = rawPerms.filter(p => {
        if (!p.service || seen.has(p.service)) return false;
        seen.add(p.service);
        return true;
      });

      // Fetch connected providers for this tenant
      const { data: connected } = await supabase
        .from('tenant_permissions')
        .select('provider')
        .eq('tenant_id', user.id);

      const connectedSet = new Set((connected ?? []).map((r: { provider: string }) => r.provider));

      setRequiredConnectors(unique.map(p => ({
        service: p.service,
        reason: p.scope ?? p.type ?? '',
        connected: connectedSet.has(p.service),
      })));
    });
  }, [missionId]);

  // ── Listen for the sign-in popup's answer ─────────────────────
  // It posts OAUTH_SUCCESS or OAUTH_ERROR; the chat records which (see handleConnectInChat).
  const oauthAnswerRef = useRef<{ ok: boolean; error?: string } | null>(null);
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'OAUTH_ERROR') {
        oauthAnswerRef.current = { ok: false, error: typeof e.data.payload === 'string' ? e.data.payload : 'The sign-in did not complete.' };
        return;
      }
      if (e.data?.type !== 'OAUTH_SUCCESS') return;
      const slug = e.data.provider as string;
      oauthAnswerRef.current = { ok: true };
      setConnectedInSession(prev => new Set([...prev, slug]));
      setConnectingSlug(null);
      setRequiredConnectors(prev => prev.map(c => c.service === slug ? { ...c, connected: true } : c));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);


  // ── Poll mission status every 8s — also refreshes title if it didn't load ──
  useEffect(() => {
    const supabase = getSupabase();
    const poll = setInterval(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('missions')
        .select('status, title, mission_json')
        .eq('id', missionId)
        .eq('tenant_id', user.id)
        .single();
      if (data?.status) setMissionStatus(data.status);
      // Fill in title if it wasn't set on initial load
      const pollTitle = data?.title || (data?.mission_json as any)?.title;
      if (pollTitle) setMissionTitle((prev) => (prev === 'Mission' ? sanitizeTitle(pollTitle) : prev));
    }, 8000);
    return () => clearInterval(poll);
  }, [missionId]);

  // ── Live runs: one shared view feeds the strip, the run cards and the header ──
  const live = useMissionLive(missionId);
  const latestRun = live?.latest?.run ?? null;
  const rehearsalNext = live?.latest?.mission.rehearsal ?? false;

  // Follow a run in the chat with a live card (once per run), polling quickly while it starts.
  const showRunCard = useCallback((runId: string) => {
    setMessages(prev => prev.some(m => runIdOf(m) === runId)
      ? prev
      : [...prev, { role: 'assistant', content: '', ts: Date.now(), runMonitor: { runId } }]);
    kickLive(missionId);
  }, [missionId]);

  // An approval decision, kept in the chat: added on the spot here (the server saved it already).
  const appendRecord = useCallback((record: ApprovalRecordPayload) => {
    setMessages(prev => prev.some(m => recordOf(m.action_payload)?.actionId === record.actionId)
      ? prev
      : [...prev, { role: 'assistant', content: decisionText(record), action_payload: record as unknown as ActionPayload, action_applied: true, ts: Date.now() }]);
  }, []);

  // ── An assistant's action card, once used, stays used (saved with its message) ──
  const resolveCard = (index: number, outcome: 'applied' | 'skipped') => {
    const target = messages[index];
    setMessages(prev => prev.map((m, j) => (j === index && m.action_payload
      ? { ...m, action_applied: true, action_payload: { ...m.action_payload, resolved: outcome } }
      : m)));
    if (target?.id && !target.id.startsWith('pending-')) {
      fetch('/api/chat-messages/resolve', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: target.id, outcome }),
      }).catch(() => { /* it is used on screen; it may show again after a reload */ });
    }
  };

  // ── Button results, kept in the chat ─────────────────────────
  // A button shows "Applying…" here, then its saved result (✓ or ✗ with the reason). Saved to the mission's
  // chat, so the history keeps it after a reload. Failures can be retried from the card.
  const runInChat = useCallback(async (
    kind: ResultKind,
    label: string,
    work: () => Promise<{ ok: boolean; detail?: string; error?: string }>,
    action?: ActionPayload,
  ) => {
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages(prev => [...prev, { id: tempId, role: 'assistant', content: '', ts: Date.now(), pendingResult: { kind, label } }]);
    let result: { ok: boolean; detail?: string; error?: string };
    try { result = await work(); } catch { result = { ok: false, error: 'Could not reach the server. Check your connection and try again.' }; }
    const entry = { type: 'action_result', kind, ok: result.ok, label, detail: result.detail, error: result.error, missionId, missionTitle, via: 'mission_chat', action };
    let saved: { entry?: ActionResultEntry; text?: string } | null = null;
    try {
      const res = await fetch('/api/chat-log', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry, missionId }),
      });
      if (res.ok) saved = await res.json();
    } catch { /* shown here even if it could not be saved */ }
    const finalEntry = saved?.entry ?? ({ ...entry, at: new Date().toISOString() } as ActionResultEntry);
    setMessages(prev => prev.map(m => (m.id === tempId
      ? { role: 'assistant', content: saved?.text ?? '', action_payload: finalEntry as unknown as ActionPayload, action_applied: true, ts: Date.now() }
      : m)));
    return result.ok;
  }, [missionId, missionTitle]);

  // Decided somewhere else (Command Center, another tab): when the pending approval goes away, show its record.
  const pendingApprovalId = live?.latest?.approval?.id ?? null;
  const seenApprovalRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = seenApprovalRef.current;
    seenApprovalRef.current = pendingApprovalId;
    if (!previous || previous === pendingApprovalId) return;
    fetch(`/api/approvals?id=${encodeURIComponent(previous)}`, { credentials: 'include', cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { record?: ApprovalRecordPayload | null } | null) => { if (d?.record) appendRecord(d.record); })
      .catch(() => { /* the record is in the chat history on the next load */ });
  }, [pendingApprovalId, appendRecord]);

  // A run already going when the page opens (a schedule, a webhook, another tab) gets its card too.
  const activeRunId = latestRun && latestRun.status !== 'completed' && latestRun.status !== 'failed' ? latestRun.id : null;
  if (activeRunId && !messages.some(m => runIdOf(m) === activeRunId)) {
    setMessages(prev => prev.some(m => runIdOf(m) === activeRunId)
      ? prev
      : [...prev, { role: 'assistant', content: '', runMonitor: { runId: activeRunId } }]);
  }

  // The header follows the latest run without waiting for the mission poll.
  const latestRunStatus = latestRun?.status;
  const displayStatus = latestRunStatus === 'failed' ? 'failed'
    : latestRunStatus && (missionStatus === 'failed' || missionStatus === 'draft') ? 'active'
    : missionStatus;

  const scrollToRunCard = useCallback(() => {
    const cards = document.querySelectorAll('[data-run-card]');
    cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Clean up Realtime subscription and audio on unmount
  useEffect(() => {
    return () => {
      if (realtimeChannelRef.current) {
        getSupabase().removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  // ── Proactive alert on first open ────────────────────────────
  useEffect(() => {
    if (messages.length === 0 && !activeSessionId) {
      fetch(`/api/missions/${missionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: [], isFirstLoad: true }),
      }).then(async res => {
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6)) as { type: string; proactiveAlert?: string };
              if (evt.type === 'proactive_alert' && evt.proactiveAlert) {
                setProactiveAlert(evt.proactiveAlert);
              }
            } catch { /* ignore */ }
          }
        }
      }).catch(() => { /* non-fatal */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  // ── Load existing session messages ────────────────────────────
  const loadSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMessages([]);
    setProactiveAlert(null);
    const res = await fetch(`/api/missions/${missionId}/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sessionId }),
    });
    if (res.ok) {
      const data = await res.json() as { messages: ChatMessage[] };
      setMessages(data.messages ?? []);
    }
  }, [missionId]);

  // ── Auto-load most recent conversation on mount ───────────────
  useEffect(() => {
    fetch(`/api/missions/${missionId}/chat/sessions`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { sessions: ChatSession[] } | null) => {
        const latest = data?.sessions?.[0];
        if (latest) loadSession(latest.id);
      })
      .catch(() => { /* non-fatal — welcome screen will show */ });
  }, [missionId, loadSession]);

  // ── Scroll to bottom ──────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── API key detection ─────────────────────────────────────────
  useEffect(() => {
    setDetectedKey(detectApiKey(input));
  }, [input]);

  // ── Inline connector: OAuth popup or API key modal ────────────
  const handleConnectInChat = useCallback(async (slug: string, label: string) => {
    if (APIKEY_CONNECTORS.has(slug)) {
      setInlineApiKeyModal({ slug, label });
      setInlineApiKeyValue('');
      setInlineApiKeyError(null);
      return;
    }
    setConnectingSlug(slug);
    oauthAnswerRef.current = null;
    await runInChat('connect', label, async () => {
      try {
        const res = await fetch('/api/composio/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ provider: slug }),
        });
        const data = await res.json() as { authUrl?: string; error?: string };
        if (!data.authUrl) return { ok: false, error: data.error ?? 'Could not start the connection.' };
        const popup = window.open(data.authUrl, 'oauth_window', 'width=600,height=700,scrollbars=yes,resizable=yes');
        if (!popup) return { ok: false, error: 'The sign-in window was blocked. Allow pop-ups for this site and try again.' };
        // Wait for the window to close, then for its answer to arrive.
        await new Promise<void>(resolve => {
          const timer = setInterval(() => { if (popup.closed) { clearInterval(timer); resolve(); } }, 600);
        });
        await new Promise(r => setTimeout(r, 400));
        const answer = oauthAnswerRef.current;
        if (!answer) return { ok: false, error: 'The sign-in window was closed before it finished.' };
        if (!answer.ok) return { ok: false, error: answer.error };
        // Persist connector to mission_json.permissions (non-fatal)
        fetch(`/api/missions/${missionId}/add-connector`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ provider: slug }),
        }).catch(() => {});
        return { ok: true, detail: 'This mission can use it now.' };
      } finally {
        setConnectingSlug(null);
      }
    }, { type: 'suggest_connector', provider: slug, label });
  }, [missionId, runInChat]);

  // ── Save API key from inline modal ────────────────────────────
  const handleInlineApiKeySave = useCallback(async () => {
    if (!inlineApiKeyModal || !inlineApiKeyValue.trim()) return;
    setInlineApiKeySaving(true);
    setInlineApiKeyError(null);
    const { slug, label } = inlineApiKeyModal;
    try {
      const vRes = await fetch('/api/connectors/apikey/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: slug, fields: { apiKey: inlineApiKeyValue.trim() } }),
      });
      const vData = await vRes.json() as { verified: boolean; error?: string };
      if (!vData.verified) {
        setInlineApiKeyError(vData.error ?? 'Invalid key — please check and try again');
        setInlineApiKeySaving(false);
        return;
      }
      const saveRes = await fetch('/api/connectors/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: slug, fields: { apiKey: inlineApiKeyValue.trim() } }),
      });
      if (!saveRes.ok) {
        const errData = await saveRes.json().catch(() => ({})) as { error?: string };
        setInlineApiKeyError(errData.error ?? 'Could not save the key. Please try again.');
        setInlineApiKeySaving(false);
        return;
      }
      setConnectedInSession(prev => new Set([...prev, slug]));
      setRequiredConnectors(prev => prev.map(c => c.service === slug ? { ...c, connected: true } : c));
      setInlineApiKeyModal(null);
      setInlineApiKeyValue('');
      void runInChat('connect', label, async () => ({ ok: true, detail: 'Your key is saved and checked. This mission can use it now.' }));
      // Register with Composio so action execution works (non-fatal)
      fetch('/api/composio/connect-apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: slug, apiKey: inlineApiKeyValue.trim() }),
      }).catch(() => {});
      // Persist connector to mission_json.permissions (non-fatal)
      fetch(`/api/missions/${missionId}/add-connector`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: slug, type: 'api_key' }),
      }).catch(() => {});
    } catch {
      setInlineApiKeyError('Could not save the key. Please try again.');
    }
    setInlineApiKeySaving(false);
  }, [inlineApiKeyModal, inlineApiKeyValue, missionId, runInChat]);

  // ── Mission share helpers ─────────────────────────────────────
  const fetchMissionMembers = useCallback(async () => {
    if (!missionId) return;
    const res = await fetch(`/api/missions/${missionId}/invite`, { credentials: 'include' });
    if (res.ok) {
      const { members } = await res.json() as { members: Array<{ id: string; member_email: string; role: string; status: string }> };
      setMissionMembers(members ?? []);
    }
  }, [missionId]);

  const sendMissionInvite = useCallback(async () => {
    if (!shareEmail.trim() || !missionId) return;
    setShareInviting(true);
    setShareResult(null);
    const res = await fetch(`/api/missions/${missionId}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: shareEmail.trim(), role: shareRole }),
    });
    if (res.ok) {
      setShareResult({ type: 'success', message: `Invite sent to ${shareEmail.trim()}` });
      setShareEmail('');
      await fetchMissionMembers();
    } else {
      const { error } = await res.json() as { error: string };
      setShareResult({ type: 'error', message: error || 'Failed to send invite' });
    }
    setShareInviting(false);
    setTimeout(() => setShareResult(null), 6000);
  }, [shareEmail, shareRole, missionId, fetchMissionMembers]);

  const revokeMissionMember = useCallback(async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email} from this mission?`)) return;
    await fetch(`/api/missions/${missionId}/invite?memberId=${memberId}`, {
      method: 'DELETE', credentials: 'include',
    });
    await fetchMissionMembers();
  }, [missionId, fetchMissionMembers]);

  // Fetch mission members when share panel opens
  useEffect(() => { if (shareOpen) { fetchMissionMembers(); } }, [shareOpen, fetchMissionMembers]);

  // ── Send message ──────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    stopSpeaking(); // stop any playing audio before sending
    setInput('');
    setDetectedKey(null);
    setProactiveAlert(null);
    setVoiceError(null);
    // Index where the assistant reply will land: current messages + user msg
    const willBeAtIdx = messages.length + 1;

    const attachment = pendingFile && !pendingFile.uploading && !pendingFile.error ? pendingFile : null;
    const finalText = attachment ? `[Attached: ${attachment.name}]\n\n${trimmed}` : trimmed;
    if (attachment) setPendingFile(null);

    const userMsg: ChatMessage = { role: 'user', content: finalText, ts: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsStreaming(true);

    const streamingMsg: ChatMessage = { role: 'assistant', content: '', isStreaming: true };
    setMessages([...newMessages, streamingMsg]);
    setToolStatusLines([]);
    waitingForInngestRef.current = false;

    // ── Handlers for Inngest Realtime events ────────────────────
    const finaliseFromInngest = (cleanText: string, action: ActionPayload | null, sid?: string, messageId?: string) => {
      const supabase = getSupabase();
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
      waitingForInngestRef.current = false;

      // Capture auto-speak intent before clearing the flag
      const shouldAutoSpeak = lastInputWasVoiceRef.current;
      lastInputWasVoiceRef.current = false;

      const finalText = stripActionTags(cleanText);

      // Capture current tool cards atomically and clear in one update to avoid stale closure
      setToolStatusLines(currentCards => {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            id: messageId, role: 'assistant', content: finalText,
            action_payload: action, isStreaming: false, isAgentRunning: false, ts: Date.now(),
            toolCards: currentCards.length > 0 ? [...currentCards] : undefined,
          };
          return updated;
        });
        return [];
      });
      setIsStreaming(false);

      if (shouldAutoSpeak) speakText(finalText, willBeAtIdx);

      if (sid && !activeSessionId) setActiveSessionId(sid);
      if (action?.type === 'suggest_connector') setQuickChips(QUICK_CHIPS_AFTER_CONNECT);
      else if (cleanText.toLowerCase().includes('fail') || cleanText.toLowerCase().includes('error'))
        setQuickChips(QUICK_CHIPS_AFTER_FAIL);
      else setQuickChips(QUICK_CHIPS_DEFAULT);

      inputRef.current?.focus();
    };

    const errorFromInngest = (message: string) => {
      const supabase = getSupabase();
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
      waitingForInngestRef.current = false;
      setToolStatusLines(currentCards => {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          const existingContent = last?.content ?? '';
          updated[updated.length - 1] = {
            role: 'assistant',
            content: existingContent,
            isStreaming: false,
            isAgentRunning: false,
            agentError: message,
            ts: Date.now(),
            toolCards: currentCards.length > 0 ? [...currentCards] : undefined,
          };
          return updated;
        });
        return [];
      });
      setIsStreaming(false);
      inputRef.current?.focus();
    };

    try {
      // Sanitize outgoing history: strip any leaked action tags from prior
      // assistant messages before they reach Claude's context window.
      const apiMessages = newMessages.map(m => ({
        role: m.role,
        content: m.role === 'assistant' ? stripActionTags(m.content) : m.content,
      }));

      const res = await fetch(`/api/missions/${missionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: apiMessages, sessionId: activeSessionId, isFirstLoad: false }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setMessages([...newMessages, { role: 'assistant', content: `${err.error ?? 'Something went wrong. Please try again.'}` }]);
        setIsStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let streamedText = '';
      let buf = '';
      let finished = false;
      // A stream can stall on its way to the browser after the server has saved the reply.
      const STALL_MS = 90_000;

      while (true) {
        let stallTimer: ReturnType<typeof setTimeout> | undefined;
        const stalled = new Promise<'stalled'>(r => { stallTimer = setTimeout(() => r('stalled'), STALL_MS); });
        const next = await Promise.race([reader.read(), stalled]);
        clearTimeout(stallTimer);
        if (next === 'stalled') { reader.cancel().catch(() => {}); break; }
        const { done, value } = next;
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as {
              type: string; text?: string; cleanText?: string; executionId?: string; approvalRecord?: ApprovalRecordPayload | null; messageId?: string | null;
              action?: ActionPayload | null; sessionId?: string; message?: string;
              name?: string; provider?: string; displayName?: string;
              status?: 'running' | 'done' | 'error'; label?: string; summary?: string; logoUrl?: string | null;
            };

            if (evt.type === 'delta' && evt.text) {
              streamedText += evt.text;
              const displayText = stripActionTags(streamedText);
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: displayText, isStreaming: true };
                return updated;
              });
            }

            if (evt.type === 'tool_status' && evt.name) {
              setToolStatusLines(prev => {
                const existing = prev.findIndex(t => t.name === evt.name);
                const entry = {
                  name: evt.name!,
                  provider: evt.provider ?? 'system',
                  displayName: evt.displayName ?? evt.name!,
                  status: evt.status ?? 'running',
                  label: evt.label ?? evt.name!,
                  summary: evt.summary,
                  logoUrl: evt.logoUrl,
                };
                if (existing >= 0) { const updated = [...prev]; updated[existing] = entry; return updated; }
                return [...prev, entry];
              });
            }

            // ── Inngest handoff ─────────────────────────────────────────
            if (evt.type === 'agent_queued' && evt.executionId) {
              if (evt.sessionId && !activeSessionId) setActiveSessionId(evt.sessionId);
              waitingForInngestRef.current = true;
              // Mark the in-progress message so UI shows the agent-running state
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, isAgentRunning: true };
                }
                return updated;
              });

              // Subscribe to Supabase Realtime for tool status and completion
              const supabase = getSupabase();
              if (realtimeChannelRef.current) supabase.removeChannel(realtimeChannelRef.current);

              const channel = supabase
                .channel(`agent-exec-${evt.executionId}`)
                .on(
                  'postgres_changes',
                  { event: 'INSERT', schema: 'public', table: 'agent_execution_events', filter: `session_id=eq.${evt.executionId}` },
                  (payload) => {
                    const row = payload.new as { event_type: string; payload: Record<string, unknown> };
                    const p = row.payload;

                    if (row.event_type === 'tool_status') {
                      setToolStatusLines(prev => {
                        const existing = prev.findIndex(t => t.name === p.name as string);
                        const entry = {
                          name: p.name as string,
                          provider: (p.provider as string) ?? 'system',
                          displayName: (p.displayName as string) ?? (p.name as string),
                          status: (p.status as 'running' | 'done' | 'error') ?? 'running',
                          label: (p.label as string) ?? (p.name as string),
                          summary: p.summary as string | undefined,
                          logoUrl: p.logoUrl as string | null | undefined,
                        };
                        if (existing >= 0) { const updated = [...prev]; updated[existing] = entry; return updated; }
                        return [...prev, entry];
                      });
                    }

                    // One complete paragraph per LLM round — safe Realtime (not token streaming)
                    if (row.event_type === 'text_delta') {
                      const deltaText = (p.text as string) ?? '';
                      if (deltaText) {
                        setMessages(prev => {
                          const updated = [...prev];
                          const last = updated[updated.length - 1];
                          if (last?.role === 'assistant' && last.isStreaming) {
                            const base = last.content;
                            const sep = base && !base.endsWith('\n') ? '\n\n' : '';
                            updated[updated.length - 1] = {
                              ...last,
                              content: stripActionTags(base + sep + deltaText),
                            };
                          }
                          return updated;
                        });
                      }
                    }

                    if (row.event_type === 'agent_completed') {
                      finaliseFromInngest(
                        (p.cleanText as string) ?? '',
                        (p.action as ActionPayload | null) ?? null,
                        p.sessionId as string | undefined,
                        (p.messageId as string | null | undefined) ?? undefined,
                      );
                      if (p.approvalRecord) appendRecord(p.approvalRecord as ApprovalRecordPayload);
                    }

                    if (row.event_type === 'agent_error') {
                      errorFromInngest((p.message as string) ?? 'Something went wrong. Please try again.');
                    }
                  }
                )
                .subscribe();

              realtimeChannelRef.current = channel;
            }

            if (evt.type === 'done') {
              finished = true;
              // Always strip action tags — even from server-provided cleanText,
              // in case the server missed secondary action blocks.
              const ft = stripActionTags(evt.cleanText ?? streamedText);
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  id: evt.messageId ?? undefined, role: 'assistant', content: ft,
                  action_payload: evt.action ?? null, isStreaming: false, ts: Date.now(),
                };
                return updated;
              });
              setToolStatusLines([]);
              // A decision given by replying ("yes, send it"): its record follows the reply.
              if (evt.approvalRecord) appendRecord(evt.approvalRecord as ApprovalRecordPayload);
              if (evt.sessionId && !activeSessionId) setActiveSessionId(evt.sessionId);
              if (evt.action?.type === 'suggest_connector') setQuickChips(QUICK_CHIPS_AFTER_CONNECT);
              else if (streamedText.toLowerCase().includes('fail') || streamedText.toLowerCase().includes('error'))
                setQuickChips(QUICK_CHIPS_AFTER_FAIL);
              else setQuickChips(QUICK_CHIPS_DEFAULT);

              // Auto-speak if the user sent this via voice
              if (lastInputWasVoiceRef.current) {
                lastInputWasVoiceRef.current = false;
                speakText(ft, willBeAtIdx);
              }
            }

            if (evt.type === 'error') {
              finished = true;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: `${evt.message ?? 'Error'}` };
                return updated;
              });
              setToolStatusLines([]);
            }
          } catch { /* skip malformed */ }
        }
      }
      if (!finished && !waitingForInngestRef.current) {
        // Load the saved conversation once the reply is in it.
        let recovered = false;
        for (let attempt = 0; attempt < 8 && !recovered; attempt++) {
          try {
            let sessionId = activeSessionId;
            if (!sessionId) {
              const r = await fetch(`/api/missions/${missionId}/chat/sessions`, { credentials: 'include' });
              sessionId = r.ok ? ((await r.json()) as { sessions: ChatSession[] }).sessions?.[0]?.id ?? null : null;
            }
            if (sessionId) {
              const r = await fetch(`/api/missions/${missionId}/chat/sessions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ sessionId }),
              });
              const saved = r.ok ? ((await r.json()) as { messages: ChatMessage[] }).messages ?? [] : [];
              const asked = saved.map(m => m.role === 'user' && m.content === userMsg.content).lastIndexOf(true);
              if (asked >= 0 && saved.slice(asked + 1).some(m => m.role === 'assistant')) {
                setActiveSessionId(sessionId);
                setMessages(saved);
                recovered = true;
              }
            }
          } catch { /* try again */ }
          if (!recovered) await new Promise(r => setTimeout(r, 5000));
        }
        if (!recovered) {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: 'The reply did not arrive. Please try again.' };
            return updated;
          });
        }
      }
    } catch (err) {
      console.error('[chat send]', err);
      setMessages([...newMessages, { role: 'assistant', content: 'Connection error. Please check your internet and try again.' }]);
    }

    // Only clear streaming state if we're NOT waiting for Inngest to complete
    if (!waitingForInngestRef.current) {
      setIsStreaming(false);
      setToolStatusLines([]);
    }
    inputRef.current?.focus();
  };

  // ── Save detected API key from message input ──────────────────
  const saveDetectedKey = async () => {
    if (!detectedKey) return;
    setSavingKey(true);
    try {
      const verifyRes = await fetch('/api/connectors/apikey/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: detectedKey.provider, fields: { apiKey: detectedKey.key } }),
      });
      const verifyData = await verifyRes.json() as { verified: boolean; error?: string; accountInfo?: string };
      if (!verifyData.verified) {
        await runInChat('connect', detectedKey.label, async () => ({ ok: false, error: verifyData.error ?? 'That key was not accepted.' }));
        setSavingKey(false);
        return;
      }
      const saveRes = await fetch('/api/connectors/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: detectedKey.provider, fields: { apiKey: detectedKey.key } }),
      });
      if (!saveRes.ok) throw new Error('Save failed');
      // Mark as connected in required connectors list too
      setConnectedInSession(prev => new Set([...prev, detectedKey.provider]));
      setRequiredConnectors(prev => prev.map(c => c.service === detectedKey.provider ? { ...c, connected: true } : c));
      setDetectedKey(null);
      setInput(prev => prev.replace(detectedKey.key, '[key saved]'));
      await runInChat('connect', detectedKey.label, async () => ({ ok: true, detail: verifyData.accountInfo || 'Your key is saved and checked.' }));
      await sendMessage(`I just connected ${detectedKey.label}. What should we update in the mission to use it?`);
    } catch {
      await runInChat('connect', detectedKey.label, async () => ({ ok: false, error: 'Could not save the key. Please try again.' }));
    }
    setSavingKey(false);
  };

  // ── Apply action from assistant card ─────────────────────────
  const applyAction = async (action: ActionPayload, msgIndex: number) => {
    // suggest_connector handled inline — should not reach applyAction, but guard anyway
    if (action.type === 'suggest_connector' && action.provider) {
      handleConnectInChat(action.provider, action.label);
      return;
    }

    setApplyingAction(msgIndex);
    resolveCard(msgIndex, 'applied');

    // Starts a run and follows it with a live card. A run that is already going shows its card instead.
    const startRun = async (body?: Record<string, unknown>) => {
      const endpoint = missionStatus === 'draft'
        ? `/api/missions/${missionId}/run`
        : `/api/missions/${missionId}/execute`;
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const data = await res.json().catch(() => ({})) as { runId?: string; error?: string; message?: string; code?: string };
      if (res.ok && data.runId) {
        setMissionStatus(prev => (prev === 'draft' || prev === 'failed' ? 'active' : prev));
        showRunCard(data.runId);
      } else if (res.status === 409 && data.code === 'run_in_progress' && data.runId) {
        // Already going (or waiting for an approval): its card says where it is.
        showRunCard(data.runId);
      } else if (res.ok) {
        kickLive(missionId);
      } else {
        const why = `${data.message ?? data.error ?? 'The run could not be started.'}`;
        await runInChat('run', action.label || 'Run this mission', async () => ({ ok: false, error: why }), action);
      }
    };

    try {
      if (action.type === 'run_now') {
        await startRun();

      } else if (action.type === 'run_selective') {
        await startRun({ selectedAgents: action.agents, executionMode: action.executionMode ?? 'sequential' });

      } else if (action.type === 'resume_run') {
        await startRun({ mode: 'resume' });

      } else if (action.type === 'go_live') {
        await runInChat('go_live', 'Live runs', async () => {
          const res = await fetch(`/api/missions/${missionId}/graduate`, { method: 'POST', credentials: 'include' });
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string };
            return { ok: false, error: err.error ?? 'Could not switch to live runs.' };
          }
          setMissionStatus('active');
          kickLive(missionId);
          return { ok: true, detail: 'From the next run, it makes real changes. Anything risky still asks you first.' };
        }, action);

      } else if (action.type === 'schedule' && action.cron) {
        const cron = action.cron;
        const timezone = action.timezone ?? 'Asia/Kolkata';
        await runInChat('schedule', action.label || cron, async () => {
          const res = await fetch(`/api/missions/${missionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ action: 'schedule', scheduleConfig: { cron, timezone } }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string };
            return { ok: false, error: err.error ?? 'Could not set the schedule.' };
          }
          setMissionStatus('paused');
          return { ok: true, detail: describeNextRun(cron, timezone) };
        }, action);

      } else if (action.type === 'webhook') {
        // The trigger endpoint needs a webhook id + secret from mission_webhooks — a mission id URL 404s.
        await runInChat('webhook', 'Trigger URL', async () => {
          const res = await fetch('/api/webhooks/manage', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ missionId, label: 'Created from mission chat' }),
          });
          if (!res.ok) return { ok: false, error: 'Could not create a webhook.' };
          const hook = await res.json() as { triggerUrl: string; secret: string };
          const details = `POST ${hook.triggerUrl}\nHeader: x-webhook-secret: ${hook.secret}\nBody: any JSON — it is passed to the first agent.`;
          try { await navigator.clipboard.writeText(details); } catch { /* ignore */ }
          window.alert(`Webhook created — save this now, the secret is shown only once:\n\n${details}\n\n(Copied to your clipboard.)`);
          // The secret is never stored in the chat; only the address is.
          return { ok: true, detail: `POST ${hook.triggerUrl} — the secret was shown once and copied to your clipboard.` };
        }, action);

      } else if (action.type === 'update_mission') {
        const jobId = crypto.randomUUID();
        const STEPS = ['analysing', 'generating', 'validating_actions', 'validating_params', 'saving'];
        const initialSteps: BlueprintStep[] = STEPS.map((s, i) => ({
          step: s,
          label: s,
          status: i === 0 ? 'active' : 'pending',
        }));

        // Insert BlueprintUpdateCard message BEFORE firing the request
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: '',
            ts: Date.now(),
            blueprintUpdate: {
              jobId,
              steps: initialSteps,
              status: 'running',
            },
          },
        ]);

        // Subscribe to Realtime for live step updates
        let announcedUpdate = false;
        const supabase = getSupabase();
        const bpChannel = supabase
          .channel(`blueprint-update-${jobId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'agent_execution_events',
              filter: `session_id=eq.${jobId}`,
            },
            (payload) => {
              const row = payload.new as { event_type: string; payload: { step?: string; label?: string; message?: string; versionNumber?: number | null; title?: string } };
              if (row.event_type === 'blueprint_step' && row.payload.step) {
                const arrivedStep = row.payload.step;
                setMessages(prev => prev.map(m => {
                  if (!m.blueprintUpdate || m.blueprintUpdate.jobId !== jobId) return m;
                  const updatedSteps = m.blueprintUpdate.steps.map(s => {
                    if (s.step === arrivedStep) return { ...s, status: 'active' as const };
                    const arrivedIdx = STEPS.indexOf(arrivedStep);
                    const sIdx = STEPS.indexOf(s.step);
                    if (sIdx < arrivedIdx) return { ...s, status: 'done' as const };
                    return s;
                  });
                  return { ...m, blueprintUpdate: { ...m.blueprintUpdate!, steps: updatedSteps } };
                }));
              } else if (row.event_type === 'blueprint_completed') {
                if (row.payload.title) setMissionTitle(sanitizeTitle(row.payload.title));
                setMessages(prev => prev.map(m => {
                  if (!m.blueprintUpdate || m.blueprintUpdate.jobId !== jobId) return m;
                  const completedSteps = m.blueprintUpdate.steps.map(s => ({ ...s, status: 'done' as const }));
                  return { ...m, blueprintUpdate: { ...m.blueprintUpdate!, steps: completedSteps, status: 'completed', versionNumber: row.payload.versionNumber } };
                }));
                // Updates run in the background now, so the completion event is what announces them.
                if (!announcedUpdate) {
                  announcedUpdate = true;
                  setMessages(prev => [
                    ...prev,
                    { role: 'assistant', content: 'Mission updated! You can run it now or keep refining. To undo, say "revert to the previous version".', ts: Date.now() },
                  ]);
                }
              } else if (row.event_type === 'blueprint_error') {
                setMessages(prev => prev.map(m => {
                  if (!m.blueprintUpdate || m.blueprintUpdate.jobId !== jobId) return m;
                  return { ...m, blueprintUpdate: { ...m.blueprintUpdate!, status: 'error', errorMessage: row.payload.message } };
                }));
              }
            }
          )
          .subscribe();

        // Fire the update request
        try {
          const res = await fetch(`/api/missions/${missionId}/update-blueprint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ request: action.summary ?? action.label, jobId }),
          });
          if (res.ok && res.status === 202) {
            // Queued as a background job — the blueprint_completed / blueprint_error events finish the card.
          } else if (res.ok) {
            const data = await res.json() as { title?: string; versionNumber?: number | null };
            if (data.title) setMissionTitle(sanitizeTitle(data.title));
            // Ensure final state is set (Realtime may have already done this)
            setMessages(prev => prev.map(m => {
              if (!m.blueprintUpdate || m.blueprintUpdate.jobId !== jobId) return m;
              if (m.blueprintUpdate.status === 'completed') return m;
              const completedSteps = m.blueprintUpdate.steps.map(s => ({ ...s, status: 'done' as const }));
              return { ...m, blueprintUpdate: { ...m.blueprintUpdate!, steps: completedSteps, status: 'completed', versionNumber: data.versionNumber } };
            }));
            if (!announcedUpdate) {
              announcedUpdate = true;
              setMessages(prev => [
                ...prev,
                { role: 'assistant', content: 'Mission updated! You can run it now or keep refining. To undo, say "revert to the previous version".', ts: Date.now() },
              ]);
            }
          } else {
            const err = await res.json().catch(() => ({})) as { error?: string };
            const errMsg = err.error ?? 'Could not update mission. Please try again.';
            setMessages(prev => prev.map(m => {
              if (!m.blueprintUpdate || m.blueprintUpdate.jobId !== jobId) return m;
              return { ...m, blueprintUpdate: { ...m.blueprintUpdate!, status: 'error', errorMessage: errMsg } };
            }));
          }
        } finally {
          setTimeout(() => supabase.removeChannel(bpChannel), 20 * 60 * 1000);
        }

      } else if (action.type === 'revert_version' && action.versionNumber) {
        const version = action.versionNumber;
        await runInChat('revert', `Version ${version}`, async () => {
          const res = await fetch(`/api/missions/${missionId}/revert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ versionNumber: version }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string };
            return { ok: false, error: err.error ?? 'Could not revert.' };
          }
          const data = await res.json() as { title?: string };
          if (data.title) setMissionTitle(sanitizeTitle(data.title));
          return { ok: true, detail: 'The state before this was saved as a new version, so this can be undone too.' };
        }, action);
      }
    } catch {
      await runInChat(KIND_OF_ACTION[action.type] ?? 'run', action.label || 'This action', async () => ({ ok: false, error: 'Something went wrong. Please try again.' }), action);
    }
    setApplyingAction(null);
  };

  // ── File upload ───────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingFile({ name: file.name, uploading: true });
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('missionId', missionId);
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

  // ── Voice recording ───────────────────────────────────────────
  const toggleVoice = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    setVoiceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const form = new FormData();
        form.append('audio', blob, 'voice.webm');
        try {
          const res = await fetch('/api/whisper/transcribe', { method: 'POST', body: form, credentials: 'include' });
          if (res.ok) {
            const data = await res.json() as { text?: string };
            if (data.text) {
              setInput(prev => (prev + ' ' + data.text).trim());
              lastInputWasVoiceRef.current = true; // flag: respond in voice
            }
          } else {
            setVoiceError('Voice transcription failed. Please type your message instead.');
          }
        } catch {
          setVoiceError('Voice transcription failed. Please type your message instead.');
        }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);
    } catch {
      setVoiceError('Microphone access denied. Please allow microphone access in your browser settings.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const allConnected = requiredConnectors.length > 0 && requiredConnectors.every(c => c.connected);
  const hasUnconnected = requiredConnectors.some(c => !c.connected);

  // ── Render ────────────────────────────────────────────────────
  return (
    <>
      <div style={{
        position: 'fixed', top: 0, left: 'var(--sidebar-width, 260px)', right: 0, bottom: 0,
        display: 'flex', background: 'var(--bg-primary)', zIndex: 40,
        fontFamily: 'var(--font-sans)',
      }}>

        {/* ── Missions Sidebar ─────────────────────────────────── */}
        <MissionsSidebar activeMissionId={missionId} />

        {/* ── Main Chat Area ──────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
            borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {missionTitle}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>AI Mission Assistant</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
              {/* Rehearsal or live: what the next run will do. Other states (draft, paused, failed) show as they are. */}
              {live && (
                <span
                  title={rehearsalNext
                    ? 'The next run is a rehearsal: nothing is sent or changed, and you check what it would do. After that, it runs for real.'
                    : 'Runs make real changes. Anything risky still asks you first.'}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.62rem', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase',
                    padding: '3px 9px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 6,
                    color: rehearsalNext ? 'var(--amber)' : 'var(--emerald)',
                    background: rehearsalNext ? 'var(--amber-bg)' : 'var(--emerald-bg)',
                    border: `1px ${rehearsalNext ? 'dashed' : 'solid'} color-mix(in srgb, currentColor 45%, transparent)`,
                  }}>
                  {!rehearsalNext && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />}
                  {rehearsalNext ? 'Rehearsal' : 'Live'}
                </span>
              )}
              {(displayStatus === 'draft' || displayStatus === 'paused' || displayStatus === 'failed') && (
                <span style={{
                  fontSize: '0.65rem', fontWeight: 600, padding: '2px 8px', borderRadius: 20, textTransform: 'capitalize',
                  color: displayStatus === 'failed' ? 'var(--rose)' : displayStatus === 'paused' ? 'var(--amber)' : 'var(--purple)',
                  border: '1px solid currentColor', opacity: 0.8,
                }}>
                  {displayStatus === 'failed' ? 'Last run failed' : displayStatus}
                </span>
              )}
              {/* A mission could only be started from a chat card or the "Run now" chip — there was no Run button. */}
              <button
                onClick={() => applyAction({ type: 'run_now', label: 'Run now' }, -1)}
                disabled={applyingAction !== null || hasUnconnected}
                title={hasUnconnected
                  ? `Connect ${requiredConnectors.filter(c => !c.connected).map(c => c.service).join(', ')} first`
                  : rehearsalNext ? 'Rehearse this mission: nothing is sent or changed' : 'Start a run of this mission'}
                className="btn btn-primary btn-sm"
                style={{ fontSize: '0.78rem' }}>
                {rehearsalNext ? 'Start rehearsal' : missionStatus === 'draft' ? 'Run' : 'Run again'}
              </button>
              <button
                onClick={() => setShareOpen(v => !v)}
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: '0.85rem' }}><Glyph e="👥" /></span> Share
              </button>
              <button onClick={() => router.push('/dashboard')}
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.78rem' }}>
                ← Missions
              </button>
            </div>
          </div>

          {/* ── Share / Mission-invite panel ── */}
          {shareOpen && (
            <div style={{
              borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)',
              padding: '16px 20px', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                  Share this mission
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: 6 }}>
                    — mission-only access (won't see other missions)
                  </span>
                </div>
                <button onClick={() => setShareOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1 }}>×</button>
              </div>

              {/* Invite form */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <input
                  type="email"
                  placeholder="colleague@company.com"
                  value={shareEmail}
                  onChange={e => setShareEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendMissionInvite()}
                  style={{ flex: 1, minWidth: 180, padding: '6px 12px', background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.85rem' }}
                />
                <select
                  value={shareRole}
                  onChange={e => setShareRole(e.target.value as typeof shareRole)}
                  style={{ padding: '6px 10px', background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: '0.82rem' }}>
                  <option value="collaborator">Collaborator</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button className="btn btn-primary btn-sm" onClick={sendMissionInvite} disabled={shareInviting || !shareEmail.trim()}>
                  {shareInviting ? 'Sending…' : 'Invite'}
                </button>
              </div>
              {shareResult && (
                <div style={{ fontSize: '0.8rem', marginBottom: 8, color: shareResult.type === 'success' ? 'var(--emerald)' : 'var(--rose)' }}>
                  {shareResult.type === 'success' ? '✓ ' : '✗ '}{shareResult.message}
                </div>
              )}

              {/* Existing members */}
              {missionMembers.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {missionMembers.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem' }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.member_email}</span>
                      <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize', flexShrink: 0 }}>{m.role}</span>
                      <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: 10, flexShrink: 0,
                        background: m.status === 'accepted' ? 'color-mix(in srgb, var(--emerald) 12%, transparent)' : 'color-mix(in srgb, var(--amber) 12%, transparent)',
                        color: m.status === 'accepted' ? 'var(--emerald)' : 'var(--amber)' }}>
                        {m.status === 'accepted' ? 'Active' : 'Pending'}
                      </span>
                      <button onClick={() => revokeMissionMember(m.id, m.member_email)}
                        style={{ background: 'none', cursor: 'pointer', color: 'var(--rose)', fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--rose)', flexShrink: 0 }}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 8 }}>
                For full dashboard access, use <a href="/settings/team" style={{ color: 'var(--accent)' }}>Team Settings</a> instead.
              </div>
            </div>
          )}

          {/* Live run strip — same view as the run card below, so the two always agree */}
          <RunStrip missionId={missionId} onView={scrollToRunCard} />

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
            <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Welcome / empty state */}
              {messages.length === 0 && !proactiveAlert && (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ display: 'inline-flex', marginBottom: 22 }}><LogoMark size={30} shape="wide" /></div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2.3rem', fontWeight: 400, lineHeight: 1.08, letterSpacing: '-0.01em', color: 'var(--text-primary)', marginBottom: 12 }}>
                    Your Mission Assistant
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.6, maxWidth: 420, margin: '0 auto 24px' }}>
                    Ask anything about <strong>{missionTitle}</strong> — run it, schedule it, add connectors, explain failures, or tell me what to improve.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {QUICK_CHIPS_DEFAULT.map(chip => (
                      <button key={chip} onClick={() => sendMessage(chip)}
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: '7px 16px', fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Proactive alert */}
              {proactiveAlert && messages.length === 0 && (
                <div style={{
                  background: 'color-mix(in srgb, var(--amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 25%, transparent)',
                  borderRadius: 'var(--radius-md)', padding: '14px 18px',
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <span style={{ fontSize: '1.1rem', flexShrink: 0 }}><Glyph e="⚡" /></span>
                  <div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--amber)', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Heads up</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{proactiveAlert}</div>
                  </div>
                  <button onClick={() => setProactiveAlert(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto', flexShrink: 0, fontSize: '0.9rem' }}>✕</button>
                </div>
              )}

              {/* ── Required Connectors Panel ─────────────────────── */}
              {requiredConnectors.length > 0 && !allConnected && (
                <div style={{
                  background: 'var(--bg-secondary)',
                  border: `1px solid ${hasUnconnected ? 'color-mix(in srgb, var(--amber) 30%, transparent)' : 'color-mix(in srgb, var(--emerald) 30%, transparent)'}`,
                  borderRadius: 'var(--radius-md)', padding: '16px',
                }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: hasUnconnected ? 'var(--amber)' : 'var(--emerald)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span><Glyph e="🔌" /></span>
                    <span>Required Connections</span>
                    {hasUnconnected && <span style={{ fontWeight: 400, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>— connect these before running</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {requiredConnectors.map(c => {
                      const isConnected = c.connected || connectedInSession.has(c.service);
                      const label = appNameNow(c.service);
                      const isConnecting = connectingSlug === c.service;
                      return (
                        <div key={c.service} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px',
                          background: 'var(--bg-card)',
                          border: `1px solid ${isConnected ? 'color-mix(in srgb, var(--emerald) 20%, transparent)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius-sm)',
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.83rem', fontWeight: 600, color: 'var(--text-primary)' }}><AppName slug={c.service} /></div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <AppDescription slug={c.service} fallback={c.reason} />
                            </div>
                          </div>
                          {isConnected ? (
                            <span style={{
                              fontSize: '0.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: 12,
                              background: 'color-mix(in srgb, var(--emerald) 10%, transparent)', color: 'var(--emerald)',
                              border: '1px solid color-mix(in srgb, var(--emerald) 20%, transparent)', whiteSpace: 'nowrap', flexShrink: 0,
                            }}>
                              ✓ Connected
                            </span>
                          ) : (
                            <button
                              onClick={() => handleConnectInChat(c.service, label)}
                              disabled={isConnecting}
                              className="btn btn-primary btn-sm"
                              style={{ fontSize: '0.73rem', flexShrink: 0, minWidth: 80 }}
                            >
                              {isConnecting ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                                  Connecting…
                                </span>
                              ) : 'Connect →'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {allConnected && (
                    <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--emerald)', textAlign: 'center' }}>
                      ✓ All connectors ready — you can run this mission now.
                    </div>
                  )}
                </div>
              )}

              {/* Messages */}
              {messages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', gap: 12, alignItems: 'flex-start' }}>
                  {/* Avatar */}
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.75rem', fontWeight: 700,
                    background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-card)',
                    border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                    color: msg.role === 'user' ? '#fff' : 'var(--accent)',
                    overflow: 'hidden',
                  }}>
                    {msg.role === 'user' ? 'You' : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <LogoMark size={22} title="Assistant" />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0, maxWidth: '84%' }}>
                    {/* Message bubble */}
                    <div data-run-card={runIdOf(msg)} style={runIdOf(msg) || entryType(msg.action_payload) || msg.pendingResult ? { maxWidth: 560 } : {
                      background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-card)',
                      border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                      borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
                      padding: '12px 16px',
                      color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                      fontSize: '0.88rem', lineHeight: 1.65,
                    }}>
                      {/* Live run card — every agent's step, any approval, rehearsal or live (also from history) */}
                      {runIdOf(msg) && (
                        <LiveRunCard
                          missionId={missionId}
                          runId={runIdOf(msg)}
                          onAsk={text => sendMessage(text)}
                          onRun={() => applyAction({ type: 'run_now', label: 'Run now' }, -1)}
                          onDecided={appendRecord}
                        />
                      )}
                      {/* An approval decision — stays in the chat with its reason */}
                      {recordOf(msg.action_payload) && (
                        <ApprovalRecord record={recordOf(msg.action_payload)!} onAsk={text => sendMessage(text)} />
                      )}
                      {/* What a button did — saved with the chat */}
                      {msg.pendingResult && <PendingResult kind={msg.pendingResult.kind} label={msg.pendingResult.label} />}
                      {entryType(msg.action_payload) === 'action_result' && (
                        <ActionResult
                          entry={msg.action_payload as unknown as ActionResultEntry}
                          onRetry={(msg.action_payload as unknown as ActionResultEntry).action?.type
                            ? () => applyAction((msg.action_payload as unknown as ActionResultEntry).action as unknown as ActionPayload, -1)
                            : undefined}
                        />
                      )}
                      {/* Blueprint update — live step-by-step progress card */}
                      {msg.blueprintUpdate && <BlueprintUpdateCard update={msg.blueprintUpdate} />}
                      {/* Tool call cards — live while streaming, persisted in completed messages */}
                      {!runIdOf(msg) && !msg.blueprintUpdate && msg.isStreaming && toolStatusLines.length > 0 && (
                        <ToolCallCards cards={toolStatusLines} />
                      )}
                      {!runIdOf(msg) && !msg.blueprintUpdate && !msg.isStreaming && msg.toolCards && msg.toolCards.length > 0 && (
                        <ToolCallCards cards={msg.toolCards} />
                      )}
                      {!runIdOf(msg) && !msg.blueprintUpdate && !entryType(msg.action_payload) && !msg.pendingResult && (msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content)}
                      {msg.isStreaming && !msg.isAgentRunning && (
                        <span style={{ display: 'inline-block', width: 2, height: 16, background: 'var(--accent)', borderRadius: 1, marginLeft: 3, animation: 'blink 0.7s step-end infinite', verticalAlign: 'text-bottom' }} />
                      )}
                      {/* Agent-running buffering indicator */}
                      {msg.isAgentRunning && (
                        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                          <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', display: 'inline-block', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Agent is working…</span>
                        </div>
                      )}
                      {/* Inline agent error — shown below content so planning text is preserved */}
                      {msg.agentError && (
                        <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'color-mix(in srgb, var(--rose) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--rose) 20%, transparent)' }}>
                          <span style={{ fontSize: '0.9rem', flexShrink: 0 }}><Glyph e="⚠️" /></span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{msg.agentError}</span>
                        </div>
                      )}
                    </div>

                    {/* Timestamp + speaker button row */}
                    {!msg.isStreaming && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, paddingLeft: msg.role === 'assistant' ? 4 : 0, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        {msg.ts && (
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                            {new Date(msg.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                          </span>
                        )}
                        {msg.role === 'assistant' && msg.content && (
                          <button
                            onClick={() => playingMsgIdx === i ? stopSpeaking() : speakText(msg.content, i)}
                            title={playingMsgIdx === i ? 'Stop' : 'Listen'}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
                              fontSize: '0.78rem', lineHeight: 1,
                              color: playingMsgIdx === i ? 'var(--accent)' : 'var(--text-muted)',
                              transition: 'color 0.15s',
                            }}
                          >
                            <Glyph e={playingMsgIdx === i ? '⏹' : '🔊'} size={14} />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Action card */}
                    {msg.role === 'assistant' && msg.action_payload && !msg.action_applied && !entryType(msg.action_payload) && (() => {
                      const a = msg.action_payload;
                      const isConnector = a.type === 'suggest_connector';
                      const connectorSlug = a.provider ?? '';
                      const connectorLabel = appNameNow(connectorSlug);
                      const isAlreadyConnected = requiredConnectors.find(c => c.service === connectorSlug)?.connected
                        || connectedInSession.has(connectorSlug);
                      const connectorDesc = isConnector && connectorSlug
                        ? <AppDescription slug={connectorSlug} fallback={`Connect ${connectorLabel} to use it in this mission.`} />
                        : null;
                      const isConnecting = connectingSlug === connectorSlug;

                      return (
                        <div style={{
                          marginTop: 10, background: 'var(--bg-secondary)',
                          border: `1px solid ${isConnector ? 'color-mix(in srgb, var(--emerald) 30%, transparent)' : 'var(--border-hover)'}`,
                          borderRadius: 'var(--radius-md)', padding: '14px 16px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>
                                <Glyph e={a.type === 'schedule' ? '📅' : a.type === 'run_now' ? '🚀' : a.type === 'resume_run' ? '▶' : a.type === 'go_live' ? '🟢' : a.type === 'suggest_connector' ? '🔌' : a.type === 'update_mission' ? '⚙️' : '🔗'} size={14} style={{ color: 'var(--accent)' }} />{' '}
                                {a.label}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                                {a.type === 'schedule' && a.cron ? `Cron: ${a.cron} (${a.timezone ?? 'Asia/Kolkata'})` :
                                 a.type === 'run_now' ? (missionStatus === 'draft' ? 'Will build and start this mission for the first time.' : 'Will trigger a fresh run of all agents.') :
                                 a.type === 'resume_run' ? 'Skips completed agents and retries only from the failed point.' :
                                 a.type === 'go_live' ? 'Switches from preview mode — real emails, posts, and actions will execute.' :
                                 a.type === 'update_mission' ? (a.summary ?? 'Applies the described changes to this mission\'s blueprint.') :
                                 connectorDesc ?? 'Connects this service to your mission.' }
                              </div>
                              {isConnector && connectorSlug && (
                                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{
                                    fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                                    background: isAlreadyConnected ? 'color-mix(in srgb, var(--emerald) 10%, transparent)' : 'color-mix(in srgb, var(--purple) 8%, transparent)',
                                    color: isAlreadyConnected ? 'var(--emerald)' : 'var(--purple)',
                                    border: `1px solid ${isAlreadyConnected ? 'color-mix(in srgb, var(--emerald) 20%, transparent)' : 'color-mix(in srgb, var(--purple) 20%, transparent)'}`,
                                  }}>
                                    {isAlreadyConnected ? '✓ ' : ''}<AppName slug={connectorSlug} />
                                  </span>
                                  {isAlreadyConnected && <span style={{ fontSize: '0.7rem', color: 'var(--emerald)' }}>Connected</span>}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}
                                onClick={() => resolveCard(i, 'skipped')}
                              >Skip</button>
                              {isConnector ? (
                                isAlreadyConnected ? (
                                  <span style={{ fontSize: '0.73rem', color: 'var(--emerald)', padding: '4px 8px', fontWeight: 600 }}>✓ Done</span>
                                ) : (
                                  <button
                                    className="btn btn-primary btn-sm"
                                    style={{ fontSize: '0.73rem', minWidth: 80 }}
                                    disabled={isConnecting}
                                    onClick={() => { resolveCard(i, 'applied'); void handleConnectInChat(connectorSlug, connectorLabel); }}
                                  >
                                    {isConnecting ? (
                                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                                        Connecting…
                                      </span>
                                    ) : 'Connect →'}
                                  </button>
                                )
                              ) : (
                                <button
                                  className="btn btn-primary btn-sm"
                                  style={{ fontSize: '0.73rem', minWidth: 72 }}
                                  disabled={applyingAction === i}
                                  onClick={() => applyAction(a, i)}
                                >
                                  {applyingAction === i ? '…' : 'Apply →'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {msg.role === 'assistant' && msg.action_payload && msg.action_applied && !entryType(msg.action_payload) && (
                      msg.action_payload.resolved === 'skipped'
                        ? <div style={{ marginTop: 5, fontSize: '0.7rem', color: 'var(--text-muted)', paddingLeft: 4 }}>Skipped</div>
                        : <div style={{ marginTop: 5, fontSize: '0.7rem', color: 'var(--emerald)', paddingLeft: 4 }}>✓ Applied</div>
                    )}

                    {/* Quick chips — only after last assistant message */}
                    {msg.role === 'assistant' && i === messages.length - 1 && !msg.isStreaming && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                        {quickChips.map(chip => (
                          <button key={chip} onClick={() => sendMessage(chip)} disabled={isStreaming}
                            style={{
                              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                              borderRadius: 20, padding: '5px 12px', fontSize: '0.75rem',
                              color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all var(--duration)',
                            }}
                            onMouseEnter={e => { const el = e.target as HTMLElement; el.style.borderColor = 'var(--accent)'; el.style.color = 'var(--accent)'; }}
                            onMouseLeave={e => { const el = e.target as HTMLElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text-secondary)'; }}
                          >
                            {chip}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* ── Input Area ─────────────────────────────────────── */}
          <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', padding: '16px 20px' }}>
            <div style={{ maxWidth: 780, margin: '0 auto' }}>

              {/* API key banner */}
              {detectedKey && (
                <div style={{
                  background: 'color-mix(in srgb, var(--emerald) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--emerald) 25%, transparent)',
                  borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: '0.8rem',
                }}>
                  <span style={{ color: 'var(--emerald)' }}>
                    <Glyph e="🔑" size={14} /> Looks like a <strong>{detectedKey.label}</strong> API key — save it to this project?
                  </span>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.73rem' }} onClick={() => setDetectedKey(null)}>Dismiss</button>
                    <button className="btn btn-primary btn-sm" style={{ fontSize: '0.73rem' }} onClick={saveDetectedKey} disabled={savingKey}>
                      {savingKey ? 'Saving…' : 'Save & Connect'}
                    </button>
                  </div>
                </div>
              )}

              {/* Voice error */}
              {voiceError && (
                <div style={{ fontSize: '0.75rem', color: 'var(--rose)', marginBottom: 8, paddingLeft: 4 }}>{voiceError}</div>
              )}

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

              {/* Hidden file input */}
              <input
                type="file"
                ref={fileInputRef}
                accept="*/*"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />

              {/* Input row */}
              <div style={{
                display: 'flex', alignItems: 'flex-end', gap: 10,
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: '10px 12px',
              }}>
                {/* Paperclip */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isStreaming || (!!pendingFile && pendingFile.uploading)}
                  title="Attach a file"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, fontSize: '1.1rem', lineHeight: 1, paddingBottom: 2, color: 'var(--text-muted)', opacity: isStreaming ? 0.4 : 1 }}
                >
                  <Glyph e="📎" size={16} />
                </button>

                <button onClick={toggleVoice} title={isRecording ? 'Stop recording' : 'Voice input'}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
                    fontSize: '1.1rem', lineHeight: 1, paddingBottom: 2,
                    color: isRecording ? 'var(--rose)' : 'var(--text-muted)',
                    animation: isRecording ? 'blink 1s step-end infinite' : 'none',
                  }}>
                  <Glyph e="🎤" size={16} />
                </button>

                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isStreaming ? 'Thinking…' : `Ask anything about "${missionTitle}"…`}
                  disabled={isStreaming}
                  rows={1}
                  style={{
                    flex: 1, background: 'none', border: 'none', outline: 'none', resize: 'none',
                    color: 'var(--text-primary)', fontSize: '0.88rem', lineHeight: 1.5,
                    fontFamily: 'var(--font-sans)', minHeight: 22, maxHeight: 160, overflowY: 'auto',
                  }}
                  onInput={e => {
                    const el = e.target as HTMLTextAreaElement;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
                    lastInputWasVoiceRef.current = false; // user is typing — no auto-speak
                  }}
                />

                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isStreaming}
                  className="btn btn-primary btn-sm"
                  style={{ flexShrink: 0, padding: '6px 14px', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', opacity: (!input.trim() || isStreaming) ? 0.4 : 1 }}
                >
                  {isStreaming ? '…' : 'Send'}
                </button>
              </div>

              <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
                Enter to send · Shift+Enter for a new line · attach a file or use voice
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Inline API Key Modal ──────────────────────────────── */}
      {inlineApiKeyModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 9000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}
          onClick={e => { if (e.target === e.currentTarget) { setInlineApiKeyModal(null); } }}
        >
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: '28px 28px 24px',
            width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-xl)',
          }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: 6 }}>
              Connect {inlineApiKeyModal.label}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.5 }}>
              <AppDescription slug={inlineApiKeyModal.slug} fallback={`Enter your ${inlineApiKeyModal.label} API key to use it in this mission.`} />
            </div>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              {API_KEY_FIELD_LABELS[inlineApiKeyModal.slug] ?? 'API Key'}
            </label>
            <input
              type="password"
              value={inlineApiKeyValue}
              onChange={e => { setInlineApiKeyValue(e.target.value); setInlineApiKeyError(null); }}
              onKeyDown={e => { if (e.key === 'Enter' && !inlineApiKeySaving) handleInlineApiKeySave(); }}
              placeholder="Paste your key here…"
              autoFocus
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                border: `1px solid ${inlineApiKeyError ? 'var(--rose)' : 'var(--border)'}`,
                background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.88rem',
                outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace',
              }}
            />
            {inlineApiKeyError && (
              <div style={{ fontSize: '0.75rem', color: 'var(--rose)', marginTop: 6 }}><Glyph e="❌" /> {inlineApiKeyError}</div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => { setInlineApiKeyModal(null); setInlineApiKeyValue(''); setInlineApiKeyError(null); }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 2 }}
                onClick={handleInlineApiKeySave}
                disabled={inlineApiKeySaving || !inlineApiKeyValue.trim()}
              >
                {inlineApiKeySaving ? 'Verifying…' : 'Save & Connect'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes fadeInUp { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
      `}</style>
    </>
  );
}
