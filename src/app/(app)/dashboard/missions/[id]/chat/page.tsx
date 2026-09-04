'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import type { RealtimeChannel } from '@supabase/supabase-js';
import MissionsSidebar from '@/components/MissionsSidebar';
import { renderMarkdown } from '@/lib/utils/render-markdown';
import { sanitizeTitle } from '@/lib/utils/sanitize-title';

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

interface RunAgent {
  id: string;
  role: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'skipped';
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
  runMonitor?: {
    runId: string;
    agents: RunAgent[];
    status: 'queued' | 'running' | 'completed' | 'failed';
    agentsDone: number;
    agentsTotal: number;
  };
}

interface ActionPayload {
  type: 'schedule' | 'run_now' | 'resume_run' | 'go_live' | 'suggest_connector' | 'webhook' | 'update_mission' | 'run_selective';
  label: string;
  cron?: string;
  timezone?: string;
  provider?: string;
  summary?: string; // used by update_mission
  agents?: string[]; // used by run_selective — array of agent IDs
  executionMode?: 'sequential' | 'parallel'; // used by run_selective
}

interface LiveRun {
  run_number: number;
  status: string;
  agents_total: number;
  agents_done: number;
  agents_failed: number;
  started_at: string;
  duration_ms: number | null;
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

// ── RunMonitorCard — live per-agent progress inside a chat bubble ─────────────

function RunMonitorCard({ monitor }: { monitor: NonNullable<ChatMessage['runMonitor']> }) {
  const { agents, status, agentsDone, agentsTotal } = monitor;
  const isFinished = status === 'completed' || status === 'failed';
  const headerColor = status === 'completed' ? 'hsla(152,69%,45%,1)'
    : status === 'failed' ? '#ef4444'
    : 'var(--accent)';
  const headerIcon = status === 'completed' ? '✅' : status === 'failed' ? '❌' : '🚀';
  const headerLabel = status === 'completed' ? 'Mission completed'
    : status === 'failed' ? 'Mission failed'
    : status === 'running' ? 'Mission running…'
    : 'Mission queued…';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {!isFinished && (
          <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: headerColor, display: 'inline-block', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
        )}
        {isFinished && <span style={{ fontSize: '0.9rem' }}>{headerIcon}</span>}
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: headerColor }}>{headerLabel}</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {agentsDone}/{agentsTotal} agents
        </span>
      </div>

      {/* Progress bar */}
      {agentsTotal > 0 && (
        <div style={{ height: 4, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
          <div style={{
            height: '100%', borderRadius: 4,
            background: status === 'failed' ? '#ef4444' : headerColor,
            width: `${Math.round((agentsDone / agentsTotal) * 100)}%`,
            transition: 'width 0.5s ease',
          }} />
        </div>
      )}

      {/* Per-agent rows */}
      {agents.map((agent, i) => {
        const agentStatus = agent.status;
        const statusColor = agentStatus === 'done' ? 'hsla(152,69%,45%,1)'
          : agentStatus === 'failed' ? '#ef4444'
          : agentStatus === 'running' ? 'var(--accent)'
          : 'var(--text-muted)';
        const statusIcon = agentStatus === 'done' ? '✓'
          : agentStatus === 'failed' ? '✗'
          : agentStatus === 'running' ? null
          : '○';

        return (
          <div key={agent.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 8,
            background: agentStatus === 'queued' ? 'transparent' : 'var(--bg-secondary)',
            border: `1px solid ${agentStatus === 'queued' ? 'transparent' : agentStatus === 'done' ? 'hsla(152,69%,45%,0.2)' : agentStatus === 'failed' ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`,
            opacity: agentStatus === 'queued' ? 0.5 : 1,
            transition: 'all 0.2s',
          }}>
            <div style={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {agentStatus === 'running' ? (
                <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              ) : (
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: statusColor }}>{statusIcon}</span>
              )}
            </div>
            <span style={{ fontSize: '0.8rem', color: agentStatus === 'queued' ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: agentStatus === 'running' ? 600 : 400 }}>
              Agent {i + 1} — {agent.role}
            </span>
            {agentStatus === 'running' && (
              <span style={{ fontSize: '0.7rem', color: 'var(--accent)', marginLeft: 'auto', fontWeight: 600 }}>Running</span>
            )}
            {agentStatus === 'done' && (
              <span style={{ fontSize: '0.7rem', color: 'hsla(152,69%,45%,1)', marginLeft: 'auto' }}>Done</span>
            )}
            {agentStatus === 'failed' && (
              <span style={{ fontSize: '0.7rem', color: '#ef4444', marginLeft: 'auto' }}>Failed</span>
            )}
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
        const statusColor = card.status === 'done' ? 'hsla(152,69%,45%,1)'
          : card.status === 'error' ? '#ef4444'
          : 'var(--accent)';
        const borderColor = card.status === 'done' ? 'hsla(152,69%,45%,0.25)'
          : card.status === 'error' ? 'rgba(239,68,68,0.25)'
          : 'var(--border)';
        const leftStripe = card.status === 'done' ? 'hsla(152,69%,45%,0.7)'
          : card.status === 'error' ? '#ef4444'
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
                  background: 'var(--accent)', color: '#fff',
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

const CONNECTOR_DESCRIPTIONS: Record<string, string> = {
  stripe: 'Accept payments and track revenue in this mission.',
  razorpay: 'Process Indian payments and subscriptions.',
  gmail: 'Send emails and read inbox from this mission.',
  slack: 'Post messages and alerts to your Slack workspace.',
  notion: 'Read and write Notion pages and databases.',
  github: 'Automate GitHub issues, PRs, and code.',
  google: 'Access Google Sheets, Drive, and Calendar.',
  sheets: 'Read and write Google Sheets automatically.',
  trello: 'Create and update Trello cards and boards.',
  hubspot: 'Sync contacts and deals in HubSpot.',
  openai: 'Use GPT-4o and DALL-E in your mission.',
  gemini: 'Use Gemini AI models in your mission.',
  canva: 'Generate and export Canva designs.',
};

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
  const [toast, setToast] = useState<string | null>(null);
  const [applyingAction, setApplyingAction] = useState<number | null>(null);
  const [liveRun, setLiveRun] = useState<LiveRun | null>(null);
  const [liveRunDismissed, setLiveRunDismissed] = useState(false);
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const runPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

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

  // ── Listen for OAuth popup success messages ──────────────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'OAUTH_SUCCESS') return;
      const slug = e.data.provider as string;
      setConnectedInSession(prev => new Set([...prev, slug]));
      setConnectingSlug(null);
      setRequiredConnectors(prev => prev.map(c => c.service === slug ? { ...c, connected: true } : c));
      showToast(`✅ ${slug} connected successfully!`);
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

  // ── Live run status polling ───────────────────────────────────
  const startRunPolling = useCallback(() => {
    if (runPollRef.current) clearInterval(runPollRef.current);
    setLiveRunDismissed(false);
    runPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/missions/${missionId}/runs`, { credentials: 'include' });
        if (!res.ok) return;
        const { runs } = await res.json() as { runs: LiveRun[] };
        const latest = runs[0];
        if (!latest) return;
        setLiveRun(latest);
        if (latest.status === 'completed' || latest.status === 'failed') {
          if (runPollRef.current) clearInterval(runPollRef.current);
          setMissionStatus(latest.status === 'completed' ? 'completed' : 'failed');
        } else {
          setMissionStatus('active');
        }
      } catch { /* non-fatal */ }
    }, 3000);
    setTimeout(() => { if (runPollRef.current) clearInterval(runPollRef.current); }, 15 * 60 * 1000);
  }, [missionId]);

  useEffect(() => () => { if (runPollRef.current) clearInterval(runPollRef.current); }, []);

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
    try {
      const res = await fetch('/api/composio/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: slug }),
      });
      const data = await res.json() as { authUrl?: string; error?: string };
      if (!data.authUrl) {
        showToast(`❌ ${data.error ?? 'Could not start connection'}`);
        setConnectingSlug(null);
        return;
      }
      const popup = window.open(data.authUrl, 'oauth_window', 'width=600,height=700,scrollbars=yes,resizable=yes');
      // Poll for popup close — when it closes, mark as connected and persist to mission
      const timer = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(timer);
          setConnectingSlug(null);
          setConnectedInSession(prev => new Set([...prev, slug]));
          setRequiredConnectors(prev => prev.map(c => c.service === slug ? { ...c, connected: true } : c));
          showToast(`✅ ${label} connected!`);
          // Persist connector to mission_json.permissions (non-fatal)
          fetch(`/api/missions/${missionId}/add-connector`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ provider: slug }),
          }).catch(() => {});
        }
      }, 600);
    } catch {
      showToast('❌ Could not start connection');
      setConnectingSlug(null);
    }
  }, [missionId]);

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
      showToast(`✅ ${label} connected!`);
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
  }, [inlineApiKeyModal, inlineApiKeyValue]);

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
    const finaliseFromInngest = (cleanText: string, action: ActionPayload | null, sid?: string) => {
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
            role: 'assistant', content: finalText,
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
        setMessages([...newMessages, { role: 'assistant', content: `⚠️ ${err.error ?? 'Something went wrong. Please try again.'}` }]);
        setIsStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let streamedText = '';
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
            const evt = JSON.parse(line.slice(6)) as {
              type: string; text?: string; cleanText?: string; executionId?: string;
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
                      );
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
              // Always strip action tags — even from server-provided cleanText,
              // in case the server missed secondary action blocks.
              const ft = stripActionTags(evt.cleanText ?? streamedText);
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: 'assistant', content: ft,
                  action_payload: evt.action ?? null, isStreaming: false, ts: Date.now(),
                };
                return updated;
              });
              setToolStatusLines([]);
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
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: `⚠️ ${evt.message ?? 'Error'}` };
                return updated;
              });
              setToolStatusLines([]);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      console.error('[chat send]', err);
      setMessages([...newMessages, { role: 'assistant', content: '⚠️ Connection error. Please check your internet and try again.' }]);
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
        showToast(`❌ ${verifyData.error ?? 'Invalid key'}`);
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
      showToast(`✅ ${detectedKey.label} connected!${verifyData.accountInfo ? ' ' + verifyData.accountInfo : ''}`);
      await sendMessage(`I just connected ${detectedKey.label}. What should we update in the mission to use it?`);
    } catch {
      showToast('❌ Could not save the key. Please try again.');
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
    setMessages(prev => {
      const u = [...prev];
      if (u[msgIndex]) u[msgIndex] = { ...u[msgIndex], action_applied: true };
      return u;
    });

    // ── Shared helper: insert RunMonitorCard + subscribe to Realtime ──
    const subscribeToRun = (runId: string, agents: Array<{ id: string; role: string }>) => {
      const runAgents: RunAgent[] = agents.map(a => ({ ...a, status: 'queued' as const }));
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: '',
          ts: Date.now(),
          runMonitor: {
            runId,
            agents: runAgents,
            status: 'queued' as const,
            agentsDone: 0,
            agentsTotal: agents.length,
          },
        },
      ]);
      const supabase = getSupabase();
      const ch = supabase
        .channel(`run-monitor-${runId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'mission_runs', filter: `id=eq.${runId}` },
          (payload) => {
            const row = payload.new as { status: string; agents_done: number; agents_total: number };
            setMessages(prev => prev.map(m => {
              if (!m.runMonitor || m.runMonitor.runId !== runId) return m;
              return { ...m, runMonitor: { ...m.runMonitor, status: row.status as 'queued' | 'running' | 'completed' | 'failed', agentsDone: row.agents_done, agentsTotal: row.agents_total } };
            }));
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'events', filter: `run_id=eq.${runId}` },
          (payload) => {
            const row = payload.new as { event_type: string; entity_id: string };
            setMessages(prev => prev.map(m => {
              if (!m.runMonitor || m.runMonitor.runId !== runId) return m;
              const updatedAgents = m.runMonitor.agents.map(a => {
                if (a.id !== row.entity_id) return a;
                if (row.event_type === 'agent.started') return { ...a, status: 'running' as const };
                if (row.event_type === 'agent.completed') return { ...a, status: 'done' as const };
                if (row.event_type === 'agent.failed') return { ...a, status: 'failed' as const };
                return a;
              });
              const runStatus: 'queued' | 'running' | 'completed' | 'failed' =
                row.event_type === 'mission.completed' ? 'completed'
                : row.event_type === 'mission.failed' ? 'failed'
                : m.runMonitor.status;
              return { ...m, runMonitor: { ...m.runMonitor, agents: updatedAgents, status: runStatus } };
            }));
          }
        )
        .subscribe();
      setTimeout(() => supabase.removeChannel(ch), 30 * 60 * 1000);
    };

    try {
      if (action.type === 'run_now') {
        showToast('🚀 Starting mission run…');
        const endpoint = missionStatus === 'draft'
          ? `/api/missions/${missionId}/run`
          : `/api/missions/${missionId}/execute`;
        const res = await fetch(endpoint, { method: 'POST', credentials: 'include' });
        if (res.ok) {
          const runData = await res.json() as { runId?: string; agents?: Array<{ id: string; role: string }> };
          startRunPolling();
          if (runData.runId && runData.agents) {
            subscribeToRun(runData.runId, runData.agents);
          } else {
            showToast('✅ Mission started!');
          }
        } else {
          const err = await res.json().catch(() => ({})) as { error?: string; message?: string };
          showToast(`❌ ${err.message ?? err.error ?? 'Could not start run.'}`);
        }

      } else if (action.type === 'run_selective') {
        showToast(`🚀 Starting selective run…`);
        const endpoint = missionStatus === 'draft'
          ? `/api/missions/${missionId}/run`
          : `/api/missions/${missionId}/execute`;
        const res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedAgents: action.agents,
            executionMode: action.executionMode ?? 'sequential',
          }),
        });
        if (res.ok) {
          const runData = await res.json() as { runId?: string; agents?: Array<{ id: string; role: string }> };
          startRunPolling();
          if (runData.runId && runData.agents) {
            subscribeToRun(runData.runId, runData.agents);
          } else {
            showToast('✅ Selective run started!');
          }
        } else {
          const err = await res.json().catch(() => ({})) as { error?: string; message?: string };
          showToast(`❌ ${err.message ?? err.error ?? 'Could not start selective run.'}`);
        }

      } else if (action.type === 'resume_run') {
        showToast('▶ Resuming from failed point…');
        const res = await fetch(`/api/missions/${missionId}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ mode: 'resume' }),
        });
        if (res.ok) {
          showToast('✅ Mission resuming!');
          startRunPolling();
        } else {
          const err = await res.json() as { error?: string };
          showToast(`❌ ${err.error ?? 'Could not resume.'}`);
        }

      } else if (action.type === 'go_live') {
        showToast('🚀 Going live…');
        const res = await fetch(`/api/missions/${missionId}/graduate`, {
          method: 'POST',
          credentials: 'include',
        });
        if (res.ok) {
          showToast('✅ Mission is now live! Real actions will execute.');
          setMissionStatus('active');
        } else {
          const err = await res.json() as { error?: string };
          showToast(`❌ ${err.error ?? 'Could not go live.'}`);
        }

      } else if (action.type === 'schedule' && action.cron) {
        showToast('📅 Applying schedule…');
        const res = await fetch(`/api/missions/${missionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            action: 'schedule',
            scheduleConfig: { cron: action.cron, timezone: action.timezone ?? 'Asia/Kolkata' },
          }),
        });
        if (res.ok) {
          showToast(`✅ Scheduled: ${action.label}`);
          setMissionStatus('paused');
        } else {
          const err = await res.json() as { error?: string };
          showToast(`❌ ${err.error ?? 'Could not set schedule. Please try from the mission page.'}`);
        }

      } else if (action.type === 'webhook') {
        const url = `${window.location.origin}/api/webhooks/trigger/${missionId}`;
        try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
        showToast(`📋 Webhook URL copied!`);

      } else if (action.type === 'update_mission') {
        showToast('⚙️ Updating mission blueprint…');
        const res = await fetch(`/api/missions/${missionId}/update-blueprint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ request: action.summary ?? action.label }),
        });
        if (res.ok) {
          const data = await res.json() as { title?: string };
          if (data.title) setMissionTitle(sanitizeTitle(data.title));
          showToast('✅ Mission updated!');
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: 'Done — the mission has been updated with your changes. You can run it now or keep refining.', ts: Date.now() },
          ]);
        } else {
          const err = await res.json().catch(() => ({})) as { error?: string };
          showToast(`❌ ${err.error ?? 'Could not update mission. Please try again.'}`);
        }
      }
    } catch {
      showToast('❌ Something went wrong. Please try again.');
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
              <span style={{
                fontSize: '0.65rem', fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                background: missionStatus === 'active' ? 'hsla(152,69%,50%,0.12)' : missionStatus === 'draft' ? 'hsla(258,90%,66%,0.12)' : 'var(--bg-card)',
                color: missionStatus === 'active' ? 'var(--emerald)' : missionStatus === 'draft' ? 'var(--purple)' : 'var(--text-muted)',
                border: '1px solid currentColor', opacity: 0.8,
              }}>
                {missionStatus}
              </span>
              <button onClick={() => router.push('/dashboard')}
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.78rem' }}>
                ← Missions
              </button>
            </div>
          </div>

          {/* Live run ticker */}
          {liveRun && !liveRunDismissed && (
            <div style={{
              background: liveRun.status === 'completed' ? 'hsla(152,69%,50%,0.1)' : liveRun.status === 'failed' ? 'hsla(0,80%,60%,0.1)' : 'hsla(258,90%,66%,0.1)',
              borderBottom: `1px solid ${liveRun.status === 'completed' ? 'hsla(152,69%,50%,0.25)' : liveRun.status === 'failed' ? 'hsla(0,80%,60%,0.25)' : 'hsla(258,90%,66%,0.25)'}`,
              padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
            }}>
              {liveRun.status !== 'completed' && liveRun.status !== 'failed' ? (
                <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              ) : liveRun.status === 'completed' ? (
                <span style={{ color: 'var(--emerald)', fontSize: '0.85rem', flexShrink: 0 }}>✓</span>
              ) : (
                <span style={{ color: 'var(--red)', fontSize: '0.85rem', flexShrink: 0 }}>✕</span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {liveRun.status === 'completed' ? 'Run completed' : liveRun.status === 'failed' ? 'Run failed' : 'Run in progress'} — #{liveRun.run_number}
                </div>
                {liveRun.agents_total > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                    <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 4,
                        background: liveRun.status === 'failed' ? 'var(--red)' : 'var(--accent)',
                        width: `${Math.round((liveRun.agents_done / liveRun.agents_total) * 100)}%`,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {liveRun.agents_done}/{liveRun.agents_total} agents
                      {liveRun.agents_failed > 0 && ` · ${liveRun.agents_failed} failed`}
                    </span>
                  </div>
                )}
              </div>
              {(liveRun.status === 'completed' || liveRun.status === 'failed') && (
                <button
                  onClick={() => sendMessage(liveRun.status === 'failed' ? 'Explain what failed and how to fix it' : 'What did the mission accomplish in that run?')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 600, flexShrink: 0 }}
                >
                  {liveRun.status === 'failed' ? 'Diagnose →' : 'Summary →'}
                </button>
              )}
              <button
                onClick={() => setLiveRunDismissed(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
                aria-label="Dismiss"
              >×</button>
            </div>
          )}

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
            <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Welcome / empty state */}
              {messages.length === 0 && !proactiveAlert && (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.png" alt="" style={{ height: 56, objectFit: 'contain', marginBottom: 16, display: 'inline-block' }} />
                  <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
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
                  background: 'hsla(38,92%,55%,0.08)', border: '1px solid hsla(38,92%,55%,0.25)',
                  borderRadius: 'var(--radius-md)', padding: '14px 18px',
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>⚡</span>
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
                  border: `1px solid ${hasUnconnected ? 'hsla(38,92%,55%,0.3)' : 'hsla(152,69%,50%,0.3)'}`,
                  borderRadius: 'var(--radius-md)', padding: '16px',
                }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: hasUnconnected ? 'var(--amber)' : 'var(--emerald)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>🔌</span>
                    <span>Required Connections</span>
                    {hasUnconnected && <span style={{ fontWeight: 400, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>— connect these before running</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {requiredConnectors.map(c => {
                      const isConnected = c.connected || connectedInSession.has(c.service);
                      const label = c.service.charAt(0).toUpperCase() + c.service.slice(1).replace(/_/g, ' ');
                      const isConnecting = connectingSlug === c.service;
                      return (
                        <div key={c.service} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px',
                          background: 'var(--bg-card)',
                          border: `1px solid ${isConnected ? 'hsla(152,69%,50%,0.2)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius-sm)',
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.83rem', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {CONNECTOR_DESCRIPTIONS[c.service.toLowerCase()] ?? c.reason}
                            </div>
                          </div>
                          {isConnected ? (
                            <span style={{
                              fontSize: '0.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: 12,
                              background: 'hsla(152,69%,50%,0.1)', color: 'var(--emerald)',
                              border: '1px solid hsla(152,69%,50%,0.2)', whiteSpace: 'nowrap', flexShrink: 0,
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
                      <img src="/logo.png" alt="Assistant" style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 2 }} />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0, maxWidth: '84%' }}>
                    {/* Message bubble */}
                    <div style={{
                      background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-card)',
                      border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                      borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
                      padding: '12px 16px',
                      color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                      fontSize: '0.88rem', lineHeight: 1.65,
                    }}>
                      {/* Run monitor — live per-agent progress card */}
                      {msg.runMonitor && <RunMonitorCard monitor={msg.runMonitor} />}
                      {/* Tool call cards — live while streaming, persisted in completed messages */}
                      {!msg.runMonitor && msg.isStreaming && toolStatusLines.length > 0 && (
                        <ToolCallCards cards={toolStatusLines} />
                      )}
                      {!msg.runMonitor && !msg.isStreaming && msg.toolCards && msg.toolCards.length > 0 && (
                        <ToolCallCards cards={msg.toolCards} />
                      )}
                      {!msg.runMonitor && (msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content)}
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
                        <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
                          <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>⚠️</span>
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
                            {playingMsgIdx === i ? '⏹' : '🔊'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Action card */}
                    {msg.role === 'assistant' && msg.action_payload && !msg.action_applied && (() => {
                      const a = msg.action_payload;
                      const isConnector = a.type === 'suggest_connector';
                      const connectorSlug = a.provider ?? '';
                      const connectorLabel = connectorSlug.charAt(0).toUpperCase() + connectorSlug.slice(1).replace(/_/g, ' ');
                      const isAlreadyConnected = requiredConnectors.find(c => c.service === connectorSlug)?.connected
                        || connectedInSession.has(connectorSlug);
                      const connectorDesc = isConnector && connectorSlug
                        ? (CONNECTOR_DESCRIPTIONS[connectorSlug.toLowerCase()] ?? `Connect ${connectorLabel} to use it in this mission.`)
                        : null;
                      const isConnecting = connectingSlug === connectorSlug;

                      return (
                        <div style={{
                          marginTop: 10, background: 'var(--bg-secondary)',
                          border: `1px solid ${isConnector ? 'hsla(152,69%,50%,0.3)' : 'var(--border-hover)'}`,
                          borderRadius: 'var(--radius-md)', padding: '14px 16px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>
                                {a.type === 'schedule' ? '📅' : a.type === 'run_now' ? '🚀' : a.type === 'resume_run' ? '▶' : a.type === 'go_live' ? '🟢' : a.type === 'suggest_connector' ? '🔌' : a.type === 'update_mission' ? '⚙️' : '🔗'}{' '}
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
                                    background: isAlreadyConnected ? 'hsla(152,69%,50%,0.1)' : 'hsla(258,90%,66%,0.08)',
                                    color: isAlreadyConnected ? 'var(--emerald)' : 'var(--purple)',
                                    border: `1px solid ${isAlreadyConnected ? 'hsla(152,69%,50%,0.2)' : 'hsla(258,90%,66%,0.2)'}`,
                                  }}>
                                    {isAlreadyConnected ? '✓ ' : ''}{connectorLabel}
                                  </span>
                                  {isAlreadyConnected && <span style={{ fontSize: '0.7rem', color: 'var(--emerald)' }}>Connected</span>}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}
                                onClick={() => setMessages(prev => {
                                  const u = [...prev];
                                  if (u[i]) u[i] = { ...u[i], action_applied: true };
                                  return u;
                                })}
                              >Skip</button>
                              {isConnector ? (
                                isAlreadyConnected ? (
                                  <span style={{ fontSize: '0.73rem', color: 'var(--emerald)', padding: '4px 8px', fontWeight: 600 }}>✓ Done</span>
                                ) : (
                                  <button
                                    className="btn btn-primary btn-sm"
                                    style={{ fontSize: '0.73rem', minWidth: 80 }}
                                    disabled={isConnecting}
                                    onClick={() => handleConnectInChat(connectorSlug, connectorLabel)}
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

                    {msg.role === 'assistant' && msg.action_payload && msg.action_applied && (
                      <div style={{ marginTop: 5, fontSize: '0.7rem', color: 'var(--emerald)', paddingLeft: 4 }}>✓ Applied</div>
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
                  background: 'hsla(152,69%,50%,0.08)', border: '1px solid hsla(152,69%,50%,0.25)',
                  borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: '0.8rem',
                }}>
                  <span style={{ color: 'var(--emerald)' }}>
                    🔑 Looks like a <strong>{detectedKey.label}</strong> API key — save it to this project?
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
                    <span>{pendingFile.uploading ? '⏳' : pendingFile.error ? '⚠️' : '📎'}</span>
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
                  📎
                </button>

                <button onClick={toggleVoice} title={isRecording ? 'Stop recording' : 'Voice input'}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
                    fontSize: '1.1rem', lineHeight: 1, paddingBottom: 2,
                    color: isRecording ? 'var(--rose)' : 'var(--text-muted)',
                    animation: isRecording ? 'blink 1s step-end infinite' : 'none',
                  }}>
                  🎤
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
                Enter to send · Shift+Enter for new line · 📎 attach file · 🎤 voice
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Inline API Key Modal ──────────────────────────────── */}
      {inlineApiKeyModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000,
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
              {CONNECTOR_DESCRIPTIONS[inlineApiKeyModal.slug] ?? `Enter your ${inlineApiKeyModal.label} API key to use it in this mission.`}
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
              <div style={{ fontSize: '0.75rem', color: 'var(--rose)', marginTop: 6 }}>❌ {inlineApiKeyError}</div>
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

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: '10px 20px',
          fontSize: '0.85rem', color: 'var(--text-primary)',
          boxShadow: 'var(--shadow-md)', zIndex: 9999, animation: 'fadeInUp 0.2s ease',
        }}>
          {toast}
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
