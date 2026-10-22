// What the sidebar needs from the chat screens: which Command Center chat is open, and that the list of
// chats changed (a new chat, a new reply). A tiny shared store — no context needed.

import { useSyncExternalStore } from 'react';

let activeChat: string | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function setActiveChat(id: string | null): void {
  if (id === activeChat) return;
  activeChat = id;
  emit();
}

/** A chat was created or got a reply: the sidebar reloads its list. */
export function chatsChanged(): void {
  version++;
  emit();
}

export const useActiveChat = () => useSyncExternalStore(subscribe, () => activeChat, () => activeChat);
export const useChatsVersion = () => useSyncExternalStore(subscribe, () => version, () => version);
