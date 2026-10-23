// One chat conversation: loads the latest session, sends messages and streams the reply, and follows
// the mission chat's background agent over Supabase Realtime until it finishes.

import type { ApprovalRecordPayload, ChatAction, ChatSession, ChatStreamEvent, SavedChatMessage } from '@contracts';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError, stream } from './api';
import { chatsChanged } from './chat-store';
import { fromSaved, historyFor, newKey, type ChatItem, type ToolLine } from './chat';
import { stripActionTags } from './markdown';
import { supabase } from './supabase';

export interface ChatOptions {
  /** POST endpoint of the chat (streams the reply). */
  endpoint: string;
  /** Sessions endpoint (GET list, POST { sessionId } → messages). */
  sessionsPath: string;
  /** Ask for the proactive alert when the conversation is empty. */
  firstLoadAlert?: boolean;
  /** Open the latest conversation only if it was used this recently; otherwise start a new one. */
  resumeWithinMs?: number;
}

/** A saved conversation: the given session, or the latest one (if used within resumeWithinMs). */
async function fetchConversation(sessionsPath: string, id?: string | null, resumeWithinMs?: number): Promise<{ sessionId: string | null; items: ChatItem[] }> {
  try {
    let sessionId = id ?? null;
    if (!sessionId) {
      const { sessions } = await api<{ sessions: ChatSession[] }>(sessionsPath);
      const latest = sessions?.[0];
      const recent = !resumeWithinMs || (latest && Date.now() - new Date(latest.updated_at).getTime() < resumeWithinMs);
      sessionId = recent ? latest?.id ?? null : null;
    }
    if (!sessionId) return { sessionId: null, items: [] };
    const { messages } = await api<{ messages: SavedChatMessage[] }>(sessionsPath, { method: 'POST', body: { sessionId } });
    return { sessionId, items: (messages ?? []).map(fromSaved) };
  } catch (err) {
    // Gone (deleted, or not this account's): a new conversation, not writing into it. Offline: keep it.
    return { sessionId: err instanceof ApiError && err.status === 404 ? null : id ?? null, items: [] };
  }
}

function upsertTool(tools: ToolLine[] | undefined, line: ToolLine): ToolLine[] {
  const list = tools ? [...tools] : [];
  const i = list.findIndex(t => t.name === line.name);
  if (i >= 0) list[i] = line; else list.push(line);
  return list;
}

export function useChat({ endpoint, sessionsPath, firstLoadAlert, resumeWithinMs }: ChatOptions) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const channel = useRef<RealtimeChannel | null>(null);
  const abort = useRef<AbortController | null>(null);

  const updateLast = useCallback((fn: (last: ChatItem) => ChatItem) => {
    setItems(prev => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
  }, []);

  const append = useCallback((item: ChatItem) => setItems(prev => [...prev, item]), []);

  /** Shows a saved conversation (the latest one when no id is given). */
  const load = useCallback(async (id?: string | null) => {
    setLoading(true);
    const conversation = await fetchConversation(sessionsPath, id);
    setSessionId(conversation.sessionId);
    setItems(conversation.items);
    setLoading(false);
  }, [sessionsPath]);

  useEffect(() => {
    let cancelled = false;
    fetchConversation(sessionsPath, null, resumeWithinMs).then(conversation => {
      if (cancelled) return;
      setSessionId(conversation.sessionId);
      setItems(conversation.items);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      abort.current?.abort();
      if (channel.current) supabase.removeChannel(channel.current);
    };
  }, [sessionsPath, resumeWithinMs]);

  // The proactive alert (a failed run, an approval waiting…) when there is no conversation yet.
  useEffect(() => {
    if (!firstLoadAlert || loading || items.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        for await (const evt of stream<ChatStreamEvent>(endpoint, { messages: [], isFirstLoad: true })) {
          if (!cancelled && evt.type === 'proactive_alert' && evt.proactiveAlert) setAlert(evt.proactiveAlert);
        }
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
  }, [endpoint, firstLoadAlert, loading, items.length]);

  /** Follows the mission chat's background agent until it finishes. */
  const followAgent = useCallback((executionId: string, onRecord: (r: ApprovalRecordPayload) => void) => {
    if (channel.current) supabase.removeChannel(channel.current);
    channel.current = supabase
      .channel(`agent-exec-${executionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_execution_events', filter: `session_id=eq.${executionId}` }, payload => {
        const row = payload.new as { event_type: string; payload: Record<string, unknown> };
        const p = row.payload ?? {};
        if (row.event_type === 'tool_status') {
          updateLast(last => ({ ...last, tools: upsertTool(last.tools, { name: String(p.name), label: String(p.label ?? p.name), status: (p.status as ToolLine['status']) ?? 'running', summary: p.summary as string | undefined }) }));
        } else if (row.event_type === 'text_delta' && typeof p.text === 'string') {
          updateLast(last => ({ ...last, content: stripActionTags(`${last.content}${last.content && !last.content.endsWith('\n') ? '\n\n' : ''}${p.text}`) }));
        } else if (row.event_type === 'agent_completed') {
          updateLast(last => ({
            ...last, streaming: false, agentRunning: false, tools: undefined,
            content: stripActionTags(typeof p.cleanText === 'string' && p.cleanText ? p.cleanText : last.content),
            action: (p.action as ChatAction | null) ?? null, id: (p.messageId as string | undefined) ?? last.id,
          }));
          if (typeof p.sessionId === 'string') setSessionId(prev => prev ?? (p.sessionId as string));
          if (p.approvalRecord) onRecord(p.approvalRecord as ApprovalRecordPayload);
          setSending(false);
          if (channel.current) supabase.removeChannel(channel.current);
        } else if (row.event_type === 'agent_error') {
          updateLast(last => ({ ...last, streaming: false, agentRunning: false, tools: undefined, content: String(p.message ?? 'Something went wrong. Please try again.') }));
          setSending(false);
        }
      })
      .subscribe();
  }, [updateLast]);

  /** Sends a message; `extra` goes with it (the OK on a plan card, an accepted mission offer). */
  const send = useCallback(async (text: string, extra?: Record<string, unknown>) => {
    const message = text.trim();
    if (!message || sending) return;
    setAlert(null);
    const user: ChatItem = { key: newKey(), role: 'user', content: message };
    const reply: ChatItem = { key: newKey(), role: 'assistant', content: '', streaming: true };
    const history = [...historyFor(items), { role: 'user' as const, content: message }];
    setItems(prev => [...prev, user, reply]);
    setSending(true);
    abort.current = new AbortController();
    let streamed = '';
    let handedOff = false;
    let finished = false;
    const record = (r: ApprovalRecordPayload) => append({ key: newKey(), role: 'assistant', content: '', action: r as unknown as ChatAction, applied: true });
    try {
      for await (const evt of stream<ChatStreamEvent>(endpoint, { messages: history, sessionId, ...extra }, abort.current.signal)) {
        if (evt.type === 'delta' && evt.text) {
          streamed += evt.text;
          const shown = stripActionTags(streamed);
          updateLast(last => ({ ...last, content: shown }));
        } else if (evt.type === 'tool_status' && evt.name) {
          updateLast(last => ({ ...last, tools: upsertTool(last.tools, { name: evt.name!, label: evt.label ?? evt.name!, status: evt.status ?? 'running', summary: evt.summary }) }));
        } else if (evt.type === 'agent_queued' && evt.executionId) {
          handedOff = true;
          if (evt.sessionId) setSessionId(prev => prev ?? evt.sessionId!);
          updateLast(last => ({ ...last, agentRunning: true }));
          followAgent(evt.executionId, record);
        } else if (evt.type === 'extra_message') {
          // The mission built alongside the plan: its card goes just before the reply.
          const extra: ChatItem = { key: newKey(), id: evt.messageId ?? undefined, role: 'assistant', content: evt.content ?? '', action: evt.action ?? null };
          setItems(prev => [...prev.slice(0, -1), extra, prev[prev.length - 1]]);
        } else if (evt.type === 'done') {
          finished = true;
          updateLast(last => ({
            ...last, streaming: false, tools: undefined, id: evt.messageId ?? undefined,
            content: stripActionTags(evt.cleanText ?? streamed), action: evt.action ?? null,
          }));
          if (evt.sessionId) setSessionId(prev => prev ?? evt.sessionId!);
          if (evt.approvalRecord) record(evt.approvalRecord);
          chatsChanged();
        } else if (evt.type === 'error') {
          finished = true;
          updateLast(last => ({ ...last, streaming: false, tools: undefined, content: evt.message ?? 'Something went wrong. Please try again.' }));
        }
      }
      if (!finished && !handedOff) {
        // The stream ended without its final event (a dropped connection): reload the saved reply.
        await load(sessionId);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        updateLast(last => ({ ...last, streaming: false, content: last.content || 'Could not reach the server. Check your connection and try again.' }));
      }
    } finally {
      if (!handedOff) setSending(false);
    }
  }, [append, endpoint, followAgent, items, load, sending, sessionId, updateLast]);

  const newConversation = useCallback(() => {
    abort.current?.abort();
    setItems([]);
    setSessionId(null);
    setSending(false);
  }, []);

  return { items, setItems, append, sessionId, loading, sending, alert, send, load, reload: () => load(sessionId), newConversation };
}
