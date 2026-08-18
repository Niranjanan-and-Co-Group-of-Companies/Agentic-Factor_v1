'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import OnboardingTour from '@/components/OnboardingTour';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChatSession { id: string; title: string; updated_at: string; }
interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  action_payload?: ActionPayload | null;
  isStreaming?: boolean;
  ts?: number;
}
interface AgentCard { name: string; icon?: string; role: string; tool?: string; trustLevel?: string; }
interface MissingConnector { service: string; reason: string; }
interface ActionPayload {
  type: string;
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
  agents?: AgentCard[];
  orchestrationPattern?: string;
  missingConnectors?: MissingConnector[];
}
interface MissionShortcut { id: string; title: string; status: string; }
interface LiveRun {
  run_number: number; status: string; agents_total: number;
  agents_done: number; agents_failed: number; started_at: string;
}

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
    active: 'var(--emerald)', failed: 'var(--red,#ef4444)',
    paused: '#f59e0b', draft: 'var(--text-muted)', completed: '#6366f1',
  };
  return colors[status] ?? 'var(--text-muted)';
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let listItems: string[] = [];
  const flushList = (key: string) => {
    if (!listItems.length) return;
    out.push(<ul key={key} style={{ margin: '6px 0 6px 18px', padding: 0 }}>{listItems.map((li, i) => <li key={i} style={{ marginBottom: 3 }}>{inlineFmt(li)}</li>)}</ul>);
    listItems = [];
  };
  const inlineFmt = (s: string): React.ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
      if (p.startsWith('*') && p.endsWith('*')) return <em key={i}>{p.slice(1, -1)}</em>;
      if (p.startsWith('`') && p.endsWith('`')) return <code key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 3, padding: '1px 5px', fontSize: '0.83em', fontFamily: 'monospace' }}>{p.slice(1, -1)}</code>;
      return p;
    });
  lines.forEach((line, i) => {
    const t = line.trim();
    if (/^[-•]\s/.test(t)) { listItems.push(t.replace(/^[-•]\s/, '')); }
    else { flushList(`l-${i}`); if (t) out.push(<span key={`s-${i}`} style={{ display: 'block' }}>{inlineFmt(t)}</span>); else if (out.length) out.push(<br key={`b-${i}`} />); }
  });
  flushList('end');
  return out;
}

const QUICK_CHIPS = ['What ran today?', 'Check my credits', 'Show all missions', 'Create a new mission'];
const CONNECTOR_LABELS: Record<string, string> = {
  gmail: 'Gmail', slack: 'Slack', github: 'GitHub', notion: 'Notion',
  hubspot: 'HubSpot', shopify: 'Shopify', linkedin: 'LinkedIn',
  google: 'Google', sheets: 'Google Sheets', discord: 'Discord',
};

const CONNECTOR_META: Record<string, { label: string; icon: string }> = {
  google: { label: 'Google', icon: '🔵' },
  gmail: { label: 'Gmail', icon: '📧' },
  buffer: { label: 'Buffer', icon: '📢' },
  openai: { label: 'OpenAI', icon: '🤖' },
  slack: { label: 'Slack', icon: '💬' },
  github: { label: 'GitHub', icon: '🐙' },
  notion: { label: 'Notion', icon: '📝' },
  hubspot: { label: 'HubSpot', icon: '🎯' },
  shopify: { label: 'Shopify', icon: '🛍️' },
  linkedin_oidc: { label: 'LinkedIn', icon: '💼' },
  linkedin: { label: 'LinkedIn', icon: '💼' },
  discord: { label: 'Discord', icon: '🎮' },
  youtube: { label: 'YouTube', icon: '🎬' },
  twitter: { label: 'Twitter / X', icon: '🐦' },
  facebook: { label: 'Facebook', icon: '📘' },
  instagram: { label: 'Instagram', icon: '📸' },
  canva: { label: 'Canva', icon: '🎨' },
  stripe: { label: 'Stripe', icon: '💳' },
  salesforce: { label: 'Salesforce', icon: '☁️' },
  airtable: { label: 'Airtable', icon: '📊' },
  asana: { label: 'Asana', icon: '✅' },
  gemini: { label: 'Gemini', icon: '✦' },
  elevenlabs: { label: 'ElevenLabs', icon: '🔊' },
  heygen: { label: 'HeyGen', icon: '🎥' },
  runwayml: { label: 'Runway ML', icon: '🎞️' },
  facebook_ads: { label: 'Meta Ads', icon: '📣' },
  google_ads: { label: 'Google Ads', icon: '📣' },
  google_analytics: { label: 'Google Analytics', icon: '📈' },
  whatsapp: { label: 'WhatsApp', icon: '💬' },
  zoho: { label: 'Zoho', icon: '🗂️' },
};
const connectorMeta = (s: string) => CONNECTOR_META[s] ?? { label: s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), icon: '🔌' };

// ── Main Component ─────────────────────────────────────────────────────────────

function CommandCenterPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Chat state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [proactiveAlert, setProactiveAlert] = useState<string | null>(null);

  // UI state — left rail hidden on mobile by default
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) setSidebarOpen(false);
  }, []);
  const [missions, setMissions] = useState<MissionShortcut[]>([]);
  const [credits, setCredits] = useState<{ remaining: number; topup: number; plan: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [applyingAction, setApplyingAction] = useState<number | null>(null);
  const [liveRun, setLiveRun] = useState<{ missionId: string; run: LiveRun } | null>(null);
  const [liveRunDismissed, setLiveRunDismissed] = useState(false);

  // Voice
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const runPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    loadSessions();
    loadMissions();
    loadCredits();
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

  const loadMissions = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('missions').select('id, title, status').eq('tenant_id', user.id).order('created_at', { ascending: false }).limit(20);
    setMissions(data ?? []);
  };

  const loadCredits = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('tenant_billing').select('credits_remaining, credits_topup, plan').eq('tenant_id', user.id).single();
    if (data) setCredits({ remaining: data.credits_remaining ?? 0, topup: data.credits_topup ?? 0, plan: data.plan ?? 'free' });
  };

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
            const evt = JSON.parse(line.slice(6)) as { type: string; proactiveAlert?: string };
            if (evt.type === 'proactive_alert' && evt.proactiveAlert) setProactiveAlert(evt.proactiveAlert);
          } catch { /* skip */ }
        }
      }
    }).catch(() => {});
  }, []);

  // ── Scroll to bottom ───────────────────────────────────────────────────────
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ── Cleanup polling ────────────────────────────────────────────────────────
  useEffect(() => () => { if (runPollRef.current) clearInterval(runPollRef.current); }, []);

  // ── Load session ───────────────────────────────────────────────────────────
  const loadSession = async (sessionId: string) => {
    setActiveSessionId(sessionId); setMessages([]); setProactiveAlert(null);
    const res = await fetch('/api/command-chat/sessions', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (res.ok) { const d = await res.json() as { messages: ChatMessage[] }; setMessages(d.messages ?? []); }
  };

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

  // ── Start run polling ──────────────────────────────────────────────────────
  const startRunPolling = useCallback((missionId: string) => {
    if (runPollRef.current) clearInterval(runPollRef.current);
    setLiveRunDismissed(false);
    runPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/missions/${missionId}/runs`, { credentials: 'include' });
        if (!res.ok) return;
        const { runs } = await res.json() as { runs: LiveRun[] };
        const latest = runs[0]; if (!latest) return;
        setLiveRun({ missionId, run: latest });
        if (latest.status === 'completed' || latest.status === 'failed') {
          if (runPollRef.current) clearInterval(runPollRef.current);
          loadMissions();
        }
      } catch { /* non-fatal */ }
    }, 3000);
    setTimeout(() => { if (runPollRef.current) clearInterval(runPollRef.current); }, 15 * 60 * 1000);
  }, []);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setInput(''); setProactiveAlert(null);

    const userMsg: ChatMessage = { role: 'user', content: trimmed, ts: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages([...newMessages, { role: 'assistant', content: '', isStreaming: true }]);
    setIsStreaming(true);

    try {
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/command-chat', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, sessionId: activeSessionId }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setMessages([...newMessages, { role: 'assistant', content: `⚠️ ${err.error ?? 'Something went wrong.'}` }]);
        setIsStreaming(false); return;
      }

      const reader = res.body!.getReader(); const dec = new TextDecoder();
      let streamed = ''; let buf = '';

      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as {
              type: string; text?: string; cleanText?: string;
              action?: ActionPayload; sessionId?: string; missionCreated?: { id: string; title: string };
            };
            if (evt.type === 'delta' && evt.text) {
              streamed += evt.text;
              setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: streamed, isStreaming: true }; return u; });
            }
            if (evt.type === 'done') {
              const final = evt.cleanText ?? streamed;
              setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: final, action_payload: evt.action ?? null, isStreaming: false, ts: Date.now() }; return u; });
              if (evt.sessionId && !activeSessionId) { setActiveSessionId(evt.sessionId); loadSessions(); }
            }
            if (evt.type === 'error') {
              setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: `⚠️ ${evt.text ?? 'Error'}` }; return u; });
            }
          } catch { /* skip */ }
        }
      }
    } catch { setMessages([...newMessages, { role: 'assistant', content: '⚠️ Connection error. Please try again.' }]); }
    setIsStreaming(false); inputRef.current?.focus();
  };

  // ── Apply action card ──────────────────────────────────────────────────────
  const applyAction = async (action: ActionPayload, msgIndex: number) => {
    setApplyingAction(msgIndex);
    try {
      if (action.type === 'run_mission' && action.missionId) {
        showToast('🚀 Starting mission…');
        const ep = action.missionStatus === 'draft'
          ? `/api/missions/${action.missionId}/run`
          : `/api/missions/${action.missionId}/execute`;
        const res = await fetch(ep, { method: 'POST', credentials: 'include' });
        if (res.ok) { showToast('✅ Mission started!'); startRunPolling(action.missionId); loadMissions(); }
        else { const e = await res.json() as { error?: string }; showToast(`❌ ${e.error ?? 'Could not start.'}`); }

      } else if (action.type === 'schedule_mission' && action.missionId && action.cron) {
        showToast('📅 Setting schedule…');
        const res = await fetch(`/api/missions/${action.missionId}`, {
          method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'schedule', scheduleConfig: { cron: action.cron, timezone: action.timezone ?? 'Asia/Kolkata' } }),
        });
        showToast(res.ok ? `✅ Scheduled: ${action.label}` : '❌ Could not set schedule.');

      } else if (action.type === 'pause_mission' && action.missionId) {
        const res = await fetch(`/api/missions/${action.missionId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pause' }) });
        showToast(res.ok ? '⏸️ Mission paused.' : '❌ Could not pause.'); if (res.ok) loadMissions();

      } else if (action.type === 'resume_mission' && action.missionId) {
        const res = await fetch(`/api/missions/${action.missionId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) });
        showToast(res.ok ? '▶️ Mission resumed.' : '❌ Could not resume.'); if (res.ok) loadMissions();

      } else if (action.type === 'suggest_connector' && action.provider) {
        router.push(`/connectors?search=${encodeURIComponent(action.provider)}`);

      } else if (action.type === 'open_mission' && action.missionId) {
        router.push(`/dashboard/missions/${action.missionId}`);

      } else if (action.type === 'show_missions') {
        router.push('/dashboard/missions');

      } else if (action.type === 'mission_created' && action.missionId) {
        router.push(`/dashboard/missions/${action.missionId}`);

      } else if (action.type === 'show_usage') {
        router.push('/dashboard/usage');
      }
    } catch { showToast('❌ Something went wrong.'); }
    setApplyingAction(null);
  };

  // ── Voice input ────────────────────────────────────────────────────────────
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
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const fd = new FormData(); fd.append('audio', blob, 'recording.webm');
        try {
          const res = await fetch('/api/whisper/transcribe', { method: 'POST', credentials: 'include', body: fd });
          if (res.ok) { const d = await res.json() as { text?: string }; if (d.text) setInput(prev => (prev + ' ' + d.text).trim()); }
        } catch { /* non-fatal */ }
      };
      mr.start(); mediaRecorderRef.current = mr; setIsRecording(true);
    } catch { showToast('❌ Microphone access denied.'); }
  };

  // ── Action Card Renderer ───────────────────────────────────────────────────
  const renderActionCard = (action: ActionPayload, msgIndex: number) => {
    const applying = applyingAction === msgIndex;
    const btnStyle: React.CSSProperties = {
      background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
      padding: '6px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: applying ? 'not-allowed' : 'pointer',
      opacity: applying ? 0.6 : 1,
    };
    const ghostBtn: React.CSSProperties = { ...btnStyle, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' };
    const card: React.CSSProperties = { marginTop: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 };

    if (action.type === 'run_mission') return (
      <div style={card}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>▶ Run "{action.missionTitle}"</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnStyle} onClick={() => applyAction(action, msgIndex)} disabled={applying}>{applying ? 'Starting…' : 'Run Now'}</button>
          <button style={ghostBtn} onClick={() => router.push(`/dashboard/missions/${action.missionId}`)}>View Mission</button>
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
        <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>📅 Schedule "{action.missionTitle}"</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{action.label ?? action.cron}</div>
        <button style={{ ...btnStyle, alignSelf: 'flex-start' }} onClick={() => applyAction(action, msgIndex)} disabled={applying}>{applying ? 'Applying…' : 'Apply Schedule'}</button>
      </div>
    );

    if (action.type === 'pause_mission' || action.type === 'resume_mission') return (
      <div style={card}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{action.type === 'pause_mission' ? '⏸ Pause' : '▶ Resume'} "{action.missionTitle}"</div>
        <button style={{ ...btnStyle, alignSelf: 'flex-start' }} onClick={() => applyAction(action, msgIndex)} disabled={applying}>{applying ? 'Working…' : 'Confirm'}</button>
      </div>
    );

    if (action.type === 'suggest_connector') return (
      <div style={card}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>🔗 Connect {CONNECTOR_LABELS[action.provider ?? ''] ?? action.provider}</div>
        {action.reason && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{action.reason}</div>}
        <button style={{ ...btnStyle, alignSelf: 'flex-start' }} onClick={() => applyAction(action, msgIndex)}>Connect Now →</button>
      </div>
    );

    if (action.type === 'mission_created') {
      const agents: AgentCard[] = action.agents ?? [];
      const patternLabel: Record<string, string> = {
        sequential: 'Sequential', parallel: 'Parallel',
        orchestrator_worker: 'Orchestrator + Workers', hierarchical: 'Hierarchical',
      };
      const agentAccent = (icon?: string): string => ({
        '🧠': '#3B82F6', '🎨': '#8B5CF6', '📲': '#22C55E', '📧': '#F59E0B',
        '🎬': '#F43F5E', '🔍': '#06B6D4', '📊': '#6366F1', '🎯': '#F97316',
        '🔔': '#EC4899',
      }[icon ?? ''] ?? '#64748B');

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
                background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem',
              }}>✨</div>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>Mission Blueprint Ready</div>
                <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: 1 }}>{action.missionTitle}</div>
              </div>
            </div>
            {action.orchestrationPattern && (
              <div style={{
                fontSize: '0.58rem', fontWeight: 800, color: '#3B82F6',
                background: 'hsla(217,91%,60%,0.1)', border: '1px solid hsla(217,91%,60%,0.25)',
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
            border: '1px solid hsla(217,91%,60%,0.22)',
            padding: '14px 14px 10px',
          }}>

            {/* Trigger Node */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--bg-card)',
              border: '1px solid hsla(38,92%,55%,0.35)',
              borderLeft: '3px solid #F59E0B',
              borderRadius: 10, padding: '10px 12px',
              boxShadow: '0 0 0 3px hsla(38,92%,55%,0.05)',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: 'hsla(38,92%,55%,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
              }}>⏰</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.59rem', fontWeight: 800, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>Entry Point · Trigger</div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>Scheduled + Manual Run</div>
              </div>
              <div style={{
                fontSize: '0.59rem', fontWeight: 800, color: '#F59E0B',
                background: 'hsla(38,92%,55%,0.1)', border: '1px solid hsla(38,92%,55%,0.25)',
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
                    }}>{agent.icon ?? '🤖'}</div>

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
          {action.missingConnectors !== undefined && (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderTop: action.missingConnectors.length > 0
                ? '1px solid hsla(0,84%,60%,0.18)'
                : '1px solid hsla(142,71%,45%,0.2)',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: '0.59rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
                Required Connectors
              </div>

              {action.missingConnectors.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.78rem', color: '#22C55E', fontWeight: 600 }}>
                  <span>✅</span> All connectors ready — you can run now
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {action.missingConnectors.map((c, idx) => {
                    const meta = connectorMeta(c.service);
                    return (
                      <div key={idx} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: 8,
                        background: 'hsla(0,84%,60%,0.05)',
                        border: '1px solid hsla(0,84%,60%,0.15)',
                      }}>
                        <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{meta.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>{meta.label}</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.reason}</div>
                        </div>
                        <button
                          onClick={() => router.push('/connectors')}
                          style={{
                            background: 'hsla(0,84%,60%,0.08)', border: '1px solid hsla(0,84%,60%,0.28)',
                            color: '#EF4444', borderRadius: 6, padding: '4px 12px',
                            fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                            flexShrink: 0, fontFamily: 'var(--font-sans)',
                          }}
                        >Connect →</button>
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.67rem', color: '#F59E0B', marginTop: 2 }}>
                    <span>⚠️</span> Connect the above before running this mission
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Action Buttons ── */}
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderTop: 'none', borderRadius: '0 0 14px 14px',
            padding: '12px 14px', display: 'flex', gap: 8,
          }}>
            <button
              style={{
                flex: 1, padding: '9px 0', borderRadius: 8,
                background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff',
                border: 'none', fontSize: '0.8rem', fontWeight: 700,
                cursor: applying ? 'not-allowed' : 'pointer', opacity: applying ? 0.6 : 1,
                fontFamily: 'var(--font-sans)',
              }}
              onClick={() => applyAction({ type: 'run_mission', missionId: action.missionId, missionTitle: action.missionTitle, missionStatus: 'active' }, msgIndex)}
              disabled={applying}
            >
              {applying ? 'Starting…' : '▶ Run Now'}
            </button>
            <button
              style={{
                flex: 1, padding: '9px 0', borderRadius: 8,
                background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', fontSize: '0.8rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
              onClick={() => router.push(`/dashboard/missions/${action.missionId}`)}
            >
              Configure Mission →
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

    if (action.type === 'mission_create_error') return (
      <div style={{ ...card, borderColor: 'var(--red,#ef4444)' }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--red,#ef4444)' }}>⚠️ Could not create mission. Try describing it differently or add more detail.</div>
        <button style={{ ...btnStyle, alignSelf: 'flex-start', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }} onClick={() => { setInput('Create a mission that '); inputRef.current?.focus(); }}>Try Again →</button>
      </div>
    );

    return null;
  };

  // ── Session groups ─────────────────────────────────────────────────────────
  const sessionGroups = groupByDate(sessions);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Onboarding tour — shown once on first login */}
      <OnboardingTour />

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9998, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 18px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)', animation: 'slideIn 0.2s ease' }}>
          {toast}
        </div>
      )}

      {/* Full-screen layout pinned past the app sidebar */}
      <div className="cc-container" style={{ position: 'fixed', top: 0, left: 'var(--sidebar-width, 260px)', right: 0, bottom: 0, display: 'flex', background: 'var(--bg-primary)', zIndex: 40, fontFamily: 'var(--font-sans)' }}>

        {/* ── Left Rail ─────────────────────────────────────────────────── */}
        {sidebarOpen && (
          <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', overflow: 'hidden' }}>

            {/* Header */}
            <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid var(--border)' }}>
              <button
                onClick={() => { setMessages([]); setActiveSessionId(null); setProactiveAlert(null); }}
                className="btn btn-primary btn-sm"
                style={{ width: '100%', justifyContent: 'center', fontSize: '0.82rem' }}
              >
                + New Chat
              </button>
            </div>

            {/* Chat History */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
              {sessions.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {Object.entries(sessionGroups).map(([group, items]) => (
                    <div key={group} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 8px 2px' }}>{group}</div>
                      {items.map(s => (
                        <div key={s.id} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                          <button
                            onClick={() => loadSession(s.id)}
                            style={{ flex: 1, textAlign: 'left', background: activeSessionId === s.id ? 'var(--accent-subtle)' : 'none', border: 'none', borderRadius: 'var(--radius-sm)', padding: '6px 28px 6px 10px', cursor: 'pointer', color: activeSessionId === s.id ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={s.title ?? 'Chat'}
                          >
                            {s.title || 'New conversation'}
                          </button>
                          <button
                            onClick={e => deleteSession(s.id, e)}
                            style={{ position: 'absolute', right: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.75rem', padding: '2px 4px', opacity: 0.6, lineHeight: 1 }}
                            title="Delete"
                          >×</button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Missions shortcuts */}
              {missions.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 8px 4px', marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    Missions
                  </div>
                  {missions.map(m => (
                    <button
                      key={m.id}
                      onClick={() => router.push(`/dashboard/missions/${m.id}/chat`)}
                      style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 'var(--radius-sm)', padding: '5px 8px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.77rem', display: 'flex', alignItems: 'center', gap: 7, overflow: 'hidden' }}
                      title={`Open ${m.title} chat`}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusDot(m.status), flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                    </button>
                  ))}
                  {missions.length >= 5 && (
                    <button onClick={() => router.push('/dashboard/missions')} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '4px 8px', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.72rem' }}>
                      View all missions →
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Credits pill at bottom */}
            {credits && (
              <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
                <button onClick={() => router.push('/dashboard/usage')} style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4 }}>Credits · {credits.plan}</div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>{(credits.remaining + credits.topup).toLocaleString()} remaining</div>
                  <div style={{ marginTop: 4, height: 3, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: credits.remaining < 100 ? '#ef4444' : 'var(--accent)', borderRadius: 4, width: `${Math.min(100, Math.round(credits.remaining / Math.max(credits.remaining + credits.topup, 1) * 100))}%` }} />
                  </div>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Main Chat Area ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0, flexWrap: 'nowrap', minHeight: 52 }}>
            <button onClick={() => setSidebarOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: 1, padding: '6px', flexShrink: 0 }} title={sidebarOpen ? 'Hide history' : 'Show history'}>☰</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Command Center</div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>Your AI Chief of Staff</div>
            </div>
            <button onClick={() => router.push('/dashboard/missions')} className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', flexShrink: 0 }}>Missions</button>
            <button onClick={() => { setInput('Create a new mission: '); inputRef.current?.focus(); }} className="btn btn-primary btn-sm" style={{ fontSize: '0.75rem', flexShrink: 0, whiteSpace: 'nowrap' }}>+ New</button>
          </div>

          {/* Live run ticker */}
          {liveRun && !liveRunDismissed && (
            <div style={{ background: liveRun.run.status === 'completed' ? 'hsla(152,69%,50%,0.1)' : liveRun.run.status === 'failed' ? 'hsla(0,80%,60%,0.1)' : 'hsla(258,90%,66%,0.1)', borderBottom: '1px solid var(--border)', padding: '7px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              {liveRun.run.status !== 'completed' && liveRun.run.status !== 'failed'
                ? <span style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                : <span style={{ fontSize: '0.8rem' }}>{liveRun.run.status === 'completed' ? '✓' : '✕'}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.77rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {liveRun.run.status === 'completed' ? 'Run completed' : liveRun.run.status === 'failed' ? 'Run failed' : 'Running…'} — #{liveRun.run.run_number}
                </div>
                {liveRun.run.agents_total > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                    <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: liveRun.run.status === 'failed' ? '#ef4444' : 'var(--accent)', width: `${Math.round(liveRun.run.agents_done / liveRun.run.agents_total * 100)}%`, transition: 'width 0.4s ease', borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)', flexShrink: 0 }}>{liveRun.run.agents_done}/{liveRun.run.agents_total} agents</span>
                  </div>
                )}
              </div>
              {(liveRun.run.status === 'completed' || liveRun.run.status === 'failed') && (
                <button onClick={() => router.push(`/dashboard/missions/${liveRun.missionId}`)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 600 }}>View →</button>
              )}
              <button onClick={() => setLiveRunDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1 }}>×</button>
            </div>
          )}

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
            <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Welcome / empty state */}
              {messages.length === 0 && !proactiveAlert && (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.png" alt="Agentic Factor" style={{ height: 56, objectFit: 'contain', marginBottom: 20, display: 'inline-block' }} />
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Command Center</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.7, maxWidth: 440, margin: '0 auto 28px' }}>
                    Run missions, check status, create automations, connect integrations — all by just saying what you need.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {QUICK_CHIPS.map(chip => (
                      <button key={chip} onClick={() => sendMessage(chip)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: '7px 16px', fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text-secondary)', transition: 'all 0.15s' }}>
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Proactive alert */}
              {proactiveAlert && messages.length === 0 && (
                <div style={{ background: 'hsla(258,90%,66%,0.08)', border: '1px solid hsla(258,90%,66%,0.2)', borderRadius: 'var(--radius-md)', padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--accent)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Update</div>
                  {proactiveAlert}
                </div>
              )}

              {/* Chat messages */}
              {messages.map((msg, i) => (
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
                    {msg.isStreaming && <span style={{ display: 'inline-block', width: 8, height: 16, background: 'var(--accent)', marginLeft: 3, borderRadius: 2, animation: 'pulse 1s infinite', verticalAlign: 'text-bottom' }} />}
                  </div>
                  {msg.role === 'assistant' && msg.action_payload && !msg.isStreaming && renderActionCard(msg.action_payload as ActionPayload, i)}
                </div>
              ))}
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
            <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
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
                style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 'var(--radius-sm)', background: isRecording ? '#ef4444' : 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', animation: isRecording ? 'pulse 1s infinite' : 'none' }}
                title="Voice input"
              >🎤</button>
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isStreaming}
                style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 'var(--radius-sm)', background: input.trim() && !isStreaming ? 'var(--accent)' : 'var(--bg-card)', border: '1px solid var(--border)', cursor: input.trim() && !isStreaming ? 'pointer' : 'not-allowed', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: input.trim() && !isStreaming ? 1 : 0.4, transition: 'all 0.15s' }}
              >↑</button>
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
