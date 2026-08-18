'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatSession {
  id: string;
  title: string;
  updated_at: string;
}

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  action_payload?: ActionPayload | null;
  action_applied?: boolean;
  isStreaming?: boolean;
}

interface ActionPayload {
  type: 'schedule' | 'run_now' | 'suggest_connector' | 'webhook';
  label: string;
  cron?: string;
  timezone?: string;
  provider?: string;
}

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

function groupSessionsByDate(sessions: ChatSession[]) {
  const groups: Record<string, ChatSession[]> = {};
  const now = new Date();
  for (const s of sessions) {
    const d = new Date(s.updated_at);
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    const key = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Yesterday' : diffDays <= 7 ? 'This Week' : 'Older';
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }
  return groups;
}

const QUICK_CHIPS_DEFAULT = ['Run now', 'View last run', 'Schedule this', 'Add a connector'];
const QUICK_CHIPS_AFTER_FAIL = ['Explain the error', 'Fix it for me', 'Run again'];
const QUICK_CHIPS_AFTER_CONNECT = ['Test with a sample run', 'Update the mission'];

// ── Main Component ────────────────────────────────────────────────────────────

export default function MissionChatPage() {
  const { id: missionId } = useParams() as { id: string };
  const router = useRouter();

  const [missionTitle, setMissionTitle] = useState('Mission');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  // ── Load mission title ──────────────────────────────────────
  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from('missions')
        .select('title')
        .eq('id', missionId)
        .eq('tenant_id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.title) setMissionTitle(data.title);
        });
    });
  }, [missionId]);

  // ── Load sessions ───────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    const res = await fetch(`/api/missions/${missionId}/chat/sessions`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json() as { sessions: ChatSession[] };
      setSessions(data.sessions ?? []);
    }
  }, [missionId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Load proactive alert on first open ─────────────────────
  useEffect(() => {
    if (messages.length === 0 && !activeSessionId) {
      fetch(`/api/missions/${missionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: [], isFirstLoad: true }),
      }).then(async res => {
        if (!res.ok) return;
        const reader = res.body!.getReader();
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

  // ── Load existing session messages ──────────────────────────
  const loadSession = async (sessionId: string) => {
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
  };

  // ── Scroll to bottom ────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── API key detection ───────────────────────────────────────
  useEffect(() => {
    const detected = detectApiKey(input);
    setDetectedKey(detected);
  }, [input]);

  // ── Send message ────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setInput('');
    setDetectedKey(null);
    setProactiveAlert(null);
    setVoiceError(null);

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsStreaming(true);

    // Add streaming placeholder
    const streamingMsg: ChatMessage = { role: 'assistant', content: '', isStreaming: true };
    setMessages([...newMessages, streamingMsg]);

    try {
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));

      const res = await fetch(`/api/missions/${missionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          messages: apiMessages,
          sessionId: activeSessionId,
          isFirstLoad: false,
        }),
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
              type: string;
              text?: string;
              cleanText?: string;
              action?: ActionPayload | null;
              sessionId?: string;
              message?: string;
            };

            if (evt.type === 'delta' && evt.text) {
              streamedText += evt.text;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: streamedText, isStreaming: true };
                return updated;
              });
            }

            if (evt.type === 'done') {
              const finalText = evt.cleanText ?? streamedText;
              const finalMsg: ChatMessage = {
                role: 'assistant',
                content: finalText,
                action_payload: evt.action ?? null,
                isStreaming: false,
              };
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = finalMsg;
                return updated;
              });
              if (evt.sessionId && !activeSessionId) {
                setActiveSessionId(evt.sessionId);
                loadSessions();
              }
              // Update chips based on context
              if (evt.action?.type === 'suggest_connector') {
                setQuickChips(QUICK_CHIPS_AFTER_CONNECT);
              } else {
                setQuickChips(QUICK_CHIPS_DEFAULT);
              }
            }

            if (evt.type === 'error') {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: `⚠️ ${evt.message ?? 'Error'}` };
                return updated;
              });
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      console.error('[chat send]', err);
      setMessages([...newMessages, { role: 'assistant', content: '⚠️ Connection error. Please try again.' }]);
    }

    setIsStreaming(false);
    inputRef.current?.focus();
  };

  // ── Save detected API key ───────────────────────────────────
  const saveDetectedKey = async () => {
    if (!detectedKey) return;
    setSavingKey(true);
    try {
      // Verify + save
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
        body: JSON.stringify({ provider: detectedKey.provider, apiKey: detectedKey.key }),
      });
      if (!saveRes.ok) throw new Error('Save failed');
      setDetectedKey(null);
      setInput(prev => prev.replace(detectedKey.key, '[key saved]'));
      showToast(`✅ ${detectedKey.label} connected!${verifyData.accountInfo ? ' ' + verifyData.accountInfo : ''}`);
      await sendMessage(`I just connected ${detectedKey.label}. What should we update in the mission to use it?`);
    } catch {
      showToast('❌ Could not save the key. Please try again.');
    }
    setSavingKey(false);
  };

  // ── Apply action from assistant card ───────────────────────
  const applyAction = async (action: ActionPayload, msgIndex: number) => {
    setMessages(prev => {
      const updated = [...prev];
      const msg = updated[msgIndex];
      if (msg) updated[msgIndex] = { ...msg, action_applied: true };
      return updated;
    });

    if (action.type === 'run_now') {
      showToast('🚀 Starting mission run…');
      fetch(`/api/missions/${missionId}/run`, { method: 'POST', credentials: 'include' })
        .then(() => {
          showToast('✅ Mission started! Watch the status on your mission page.');
          router.push(`/dashboard/missions/${missionId}`);
        })
        .catch(() => showToast('❌ Could not start run. Please try from the mission page.'));
    } else if (action.type === 'schedule' && action.cron) {
      showToast('📅 Applying schedule…');
      fetch(`/api/missions/${missionId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cron_expression: action.cron, timezone: action.timezone ?? 'Asia/Kolkata', is_active: true }),
      }).then(() => showToast(`✅ Scheduled: ${action.label}`))
        .catch(() => showToast('❌ Could not set schedule. Please try from the mission page.'));
    } else if (action.type === 'suggest_connector' && action.provider) {
      router.push(`/connectors?search=${action.provider}`);
    } else if (action.type === 'webhook') {
      const url = `${window.location.origin}/api/webhooks/trigger/${missionId}`;
      await navigator.clipboard.writeText(url).catch(() => { /* ignore */ });
      showToast(`📋 Webhook URL copied: …/api/webhooks/trigger/${missionId.slice(0, 8)}…`);
    }
  };

  // ── Voice recording ─────────────────────────────────────────
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
        const res = await fetch('/api/whisper/transcribe', { method: 'POST', body: form, credentials: 'include' });
        if (res.ok) {
          const data = await res.json() as { text?: string };
          if (data.text) setInput(prev => (prev + ' ' + data.text).trim());
        } else {
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

  // ── Input key handler ───────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const sessionGroups = groupSessionsByDate(sessions);

  // ── Render ─────────────────────────────────────────────────
  return (
    <>
      {/* Full-screen overlay starting after the sidebar */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 260,
        right: 0,
        bottom: 0,
        display: 'flex',
        background: 'var(--bg-primary)',
        zIndex: 40,
        fontFamily: 'var(--font-sans)',
      }}>

        {/* ── Left Rail — Session List ──────────────────────── */}
        {sidebarOpen && (
          <div style={{
            width: 252,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-secondary)',
          }}>
            {/* Rail header */}
            <div style={{
              padding: '16px 14px 12px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <button
                onClick={() => { setMessages([]); setActiveSessionId(null); setProactiveAlert(null); }}
                className="btn btn-primary btn-sm"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                + New Chat
              </button>
              <button
                onClick={() => router.push(`/dashboard/missions/${missionId}`)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: '0.75rem',
                  textAlign: 'left', padding: '2px 0',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                ← Back to mission
              </button>
            </div>

            {/* Session list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
              {sessions.length === 0 ? (
                <div style={{ padding: '20px 10px', color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>
                  No past conversations yet.<br />Start chatting to build history.
                </div>
              ) : (
                Object.entries(sessionGroups).map(([group, items]) => (
                  <div key={group} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 8px 2px' }}>
                      {group}
                    </div>
                    {items.map(s => (
                      <button
                        key={s.id}
                        onClick={() => loadSession(s.id)}
                        style={{
                          width: '100%', textAlign: 'left', background: activeSessionId === s.id ? 'var(--accent-subtle)' : 'none',
                          border: 'none', borderRadius: 'var(--radius-sm)', padding: '7px 10px',
                          cursor: 'pointer', color: activeSessionId === s.id ? 'var(--accent)' : 'var(--text-secondary)',
                          fontSize: '0.8rem', lineHeight: 1.3,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          transition: 'all var(--duration)',
                        }}
                        title={s.title ?? 'Chat'}
                      >
                        {s.title || 'Untitled chat'}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Main Chat Area ────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

          {/* Chat header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            flexShrink: 0,
          }}>
            <button
              onClick={() => setSidebarOpen(o => !o)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1 }}
              title={sidebarOpen ? 'Hide history' : 'Show history'}
            >
              ☰
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {missionTitle}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>AI Mission Assistant</div>
            </div>
            <button
              onClick={() => router.push(`/dashboard/missions/${missionId}`)}
              className="btn btn-ghost btn-sm"
              style={{ flexShrink: 0, fontSize: '0.78rem' }}
            >
              View Mission →
            </button>
          </div>

          {/* Messages scroll area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
            <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Empty state / welcome */}
              {messages.length === 0 && !proactiveAlert && (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ fontSize: '3rem', marginBottom: 16 }}>💬</div>
                  <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
                    Your Mission Assistant
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>
                    Ask anything about <strong>{missionTitle}</strong> — improve it, run it, schedule it,
                    add connectors, explain failures, or suggest what to build next.
                  </p>
                </div>
              )}

              {/* Proactive alert */}
              {proactiveAlert && messages.length === 0 && (
                <div style={{
                  background: 'var(--amber-bg)',
                  border: '1px solid hsla(38,92%,55%,0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 18px',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                }}>
                  <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>⚡</span>
                  <div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--amber)', fontWeight: 600, marginBottom: 4 }}>Heads up</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{proactiveAlert}</div>
                  </div>
                </div>
              )}

              {/* Messages */}
              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: 'flex',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  gap: 12,
                  alignItems: 'flex-start',
                }}>
                  {/* Avatar */}
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.85rem', fontWeight: 700,
                    background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-card)',
                    border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                    color: msg.role === 'user' ? '#fff' : 'var(--text-secondary)',
                  }}>
                    {msg.role === 'user' ? 'U' : '✦'}
                  </div>

                  <div style={{ flex: 1, minWidth: 0, maxWidth: '85%' }}>
                    {/* Message bubble */}
                    <div style={{
                      background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-card)',
                      border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                      borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
                      padding: '12px 16px',
                      color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                      fontSize: '0.88rem',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>
                      {msg.content}
                      {msg.isStreaming && (
                        <span style={{ display: 'inline-block', width: 8, height: 14, background: 'var(--accent)', borderRadius: 2, marginLeft: 4, animation: 'blink 0.8s step-end infinite', verticalAlign: 'text-bottom' }} />
                      )}
                    </div>

                    {/* Action card */}
                    {msg.role === 'assistant' && msg.action_payload && !msg.action_applied && (
                      <div style={{
                        marginTop: 10,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-hover)',
                        borderRadius: 'var(--radius-md)',
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                      }}>
                        <div>
                          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                            {msg.action_payload.type === 'schedule' ? '📅' :
                             msg.action_payload.type === 'run_now' ? '🚀' :
                             msg.action_payload.type === 'suggest_connector' ? '🔌' : '🔗'} {msg.action_payload.label}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {msg.action_payload.type === 'schedule' ? 'Will set this schedule for your mission' :
                             msg.action_payload.type === 'run_now' ? 'Will trigger a live run immediately' :
                             msg.action_payload.type === 'suggest_connector' ? 'Will take you to the connector setup' :
                             'Will copy the webhook URL to clipboard'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}
                            onClick={() => setMessages(prev => {
                              const u = [...prev];
                              if (u[i]) u[i] = { ...u[i], action_applied: true };
                              return u;
                            })}
                          >
                            Skip
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ fontSize: '0.75rem' }}
                            onClick={() => applyAction(msg.action_payload!, i)}
                          >
                            Apply →
                          </button>
                        </div>
                      </div>
                    )}
                    {msg.role === 'assistant' && msg.action_payload && msg.action_applied && (
                      <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--emerald)', paddingLeft: 4 }}>
                        ✓ Applied
                      </div>
                    )}

                    {/* Quick chips — only after last assistant message */}
                    {msg.role === 'assistant' && i === messages.length - 1 && !msg.isStreaming && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                        {quickChips.map(chip => (
                          <button
                            key={chip}
                            onClick={() => sendMessage(chip)}
                            disabled={isStreaming}
                            style={{
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border)',
                              borderRadius: 20,
                              padding: '5px 12px',
                              fontSize: '0.75rem',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              transition: 'all var(--duration)',
                            }}
                            onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = 'var(--accent)'; (e.target as HTMLElement).style.color = 'var(--accent)'; }}
                            onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'var(--border)'; (e.target as HTMLElement).style.color = 'var(--text-secondary)'; }}
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

          {/* ── Input Area ─────────────────────────────────── */}
          <div style={{
            flexShrink: 0,
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            padding: '16px 20px',
          }}>
            <div style={{ maxWidth: 780, margin: '0 auto' }}>

              {/* API key detection banner */}
              {detectedKey && (
                <div style={{
                  background: 'var(--emerald-bg)',
                  border: '1px solid hsla(152,69%,50%,0.3)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 14px',
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  fontSize: '0.8rem',
                }}>
                  <span style={{ color: 'var(--emerald)' }}>
                    🔑 Looks like a <strong>{detectedKey.label}</strong> API key — save it to this project?
                  </span>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}
                      onClick={() => setDetectedKey(null)}>Dismiss</button>
                    <button className="btn btn-primary btn-sm" style={{ fontSize: '0.73rem' }}
                      onClick={saveDetectedKey} disabled={savingKey}>
                      {savingKey ? 'Saving…' : 'Save & Connect'}
                    </button>
                  </div>
                </div>
              )}

              {/* Voice error */}
              {voiceError && (
                <div style={{ fontSize: '0.75rem', color: 'var(--rose)', marginBottom: 8, paddingLeft: 4 }}>
                  {voiceError}
                </div>
              )}

              {/* Input row */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 10,
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: '10px 12px',
                transition: 'border-color var(--duration)',
              }}
              onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-hover)'; }}
              onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
              >
                {/* Voice button */}
                <button
                  onClick={toggleVoice}
                  title={isRecording ? 'Stop recording' : 'Voice input'}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
                    fontSize: '1.1rem', lineHeight: 1, paddingBottom: 2,
                    color: isRecording ? 'var(--rose)' : 'var(--text-muted)',
                    animation: isRecording ? 'blink 1s step-end infinite' : 'none',
                    transition: 'color var(--duration)',
                  }}
                >
                  🎤
                </button>

                {/* Text area */}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Ask anything about "${missionTitle}"…`}
                  disabled={isStreaming}
                  rows={1}
                  style={{
                    flex: 1, background: 'none', border: 'none', outline: 'none', resize: 'none',
                    color: 'var(--text-primary)', fontSize: '0.88rem', lineHeight: 1.5,
                    fontFamily: 'var(--font-sans)', minHeight: 22, maxHeight: 160,
                    overflowY: 'auto',
                  }}
                  onInput={e => {
                    const el = e.target as HTMLTextAreaElement;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
                  }}
                />

                {/* Send button */}
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isStreaming}
                  className="btn btn-primary btn-sm"
                  style={{
                    flexShrink: 0, padding: '6px 14px', borderRadius: 'var(--radius-md)',
                    fontSize: '0.82rem', opacity: (!input.trim() || isStreaming) ? 0.45 : 1,
                  }}
                >
                  {isStreaming ? '…' : 'Send'}
                </button>
              </div>

              <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
                Enter to send · Shift+Enter for new line · Shift+click mic to record voice
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: '10px 20px',
          fontSize: '0.85rem', color: 'var(--text-primary)',
          boxShadow: 'var(--shadow-md)', zIndex: 9999,
          animation: 'fadeInUp 0.2s ease',
        }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes fadeInUp { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
      `}</style>
    </>
  );
}
