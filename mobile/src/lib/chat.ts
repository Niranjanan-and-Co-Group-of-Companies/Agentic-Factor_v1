// What a chat shows: messages, the cards replies carry, and entries saved into the history
// (run cards, button results, approval decisions, thread notes).

import type { ChatAction, ResultKind, SavedChatMessage } from '@contracts';

import { stripActionTags } from './markdown';

export interface ToolLine { name: string; label: string; status: 'running' | 'done' | 'error'; summary?: string }

export interface ChatItem {
  key: string;
  /** The saved message's id (cards are marked used against it). */
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  action?: ChatAction | null;
  /** The card's button was used. */
  applied?: boolean;
  streaming?: boolean;
  /** The mission chat's agent is working (tools are running in the background). */
  agentRunning?: boolean;
  tools?: ToolLine[];
  /** A button's action while it is applied (replaced by its saved result). */
  pending?: { kind: ResultKind; label: string };
  /** A run started from this chat, followed live. */
  run?: { missionId: string; runId: string };
  createdAt?: string;
}

const ENTRY_TYPES = new Set(['run_card', 'action_result', 'approval_record', 'thread_note']);

/** Saved entries are drawn as cards, not as text. */
export const isEntry = (action: ChatAction | null | undefined) => !!action && ENTRY_TYPES.has(action.type);

let seq = 0;
export const newKey = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

export function fromSaved(m: SavedChatMessage): ChatItem {
  return {
    key: m.id, id: m.id, role: m.role, createdAt: m.created_at,
    content: m.role === 'assistant' ? stripActionTags(m.content ?? '') : m.content ?? '',
    action: m.action_payload, applied: !!m.action_applied,
  };
}

/** The conversation sent with a new message: the text of recent turns (cards and entries left out). */
export function historyFor(items: ChatItem[], limit = 20): { role: 'user' | 'assistant'; content: string }[] {
  return items
    .filter(i => !i.pending && !i.run && !isEntry(i.action) && i.content.trim())
    .slice(-limit)
    .map(i => ({ role: i.role, content: i.content }));
}
