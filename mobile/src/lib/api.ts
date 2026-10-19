// The app talks to the same API as the website, signed in with the user's session token.

import { fetch } from 'expo/fetch';

import { API_URL } from './config';
import { createSSEParser } from './sse';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown> = {}) {
    super(message);
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api<T = Record<string, unknown>>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(await authHeaders()), ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof data.message === 'string' ? data.message : typeof data.error === 'string' ? data.error : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

/** POSTs and yields each event of the streamed reply as it arrives. */
export async function* stream<T = Record<string, unknown>>(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new ApiError(typeof data.error === 'string' ? data.error : `Request failed (${res.status})`, res.status, data);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser<T>();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const event of parser.push(decoder.decode(value, { stream: true }))) yield event;
  }
}
