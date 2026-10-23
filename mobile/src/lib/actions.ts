// What the chat cards' buttons do — the same requests the website makes.

import type { ActionResultEntry, ApprovalRecordPayload, ResultKind } from '@contracts';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { api, ApiError } from './api';

export type Outcome = { ok: boolean; detail?: string; error?: string };

/** Saves a button's result into the chat history (and the mission's chat); returns the saved entry. */
export async function saveResult(
  draft: { kind: ResultKind; label: string; missionId?: string; missionTitle?: string; via: 'mission_chat' | 'command_center'; action?: Record<string, unknown> } & Outcome,
  where: { missionId?: string; commandSessionId?: string | null },
): Promise<ActionResultEntry> {
  const entry = { type: 'action_result' as const, ...draft };
  try {
    const res = await api<{ entry?: ActionResultEntry }>('/api/chat-log', {
      method: 'POST', body: { entry, missionId: where.missionId, commandSessionId: where.commandSessionId ?? undefined },
    });
    if (res.entry) return res.entry;
  } catch { /* shown in the chat even if it could not be saved */ }
  return { ...entry, at: new Date().toISOString() };
}

/** Marks a card's button as used, so it stays used after a reload. */
export function markUsed(messageId: string | undefined): void {
  if (messageId) api('/api/chat-messages/resolve', { method: 'POST', body: { messageId, outcome: 'applied' } }).catch(() => {});
}

/** Starts a run (draft missions provision first). Returns its id; one already going is returned too. */
export async function startRun(missionId: string, missionStatus?: string, body?: Record<string, unknown>): Promise<string> {
  const path = missionStatus === 'draft' ? `/api/missions/${missionId}/run` : `/api/missions/${missionId}/execute`;
  try {
    const res = await api<{ runId?: string }>(path, { method: 'POST', body: body ?? {} });
    if (res.runId) return res.runId;
    throw new Error('The run could not be started.');
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 409 && err.body.code === 'run_in_progress' && typeof err.body.runId === 'string') return err.body.runId;
      // A draft that was already provisioned: start it as a saved mission.
      if (err.status === 409 && err.body.error === 'already_started') return startRun(missionId, 'active', body);
    }
    throw err;
  }
}

export async function patchMission(missionId: string, body: Record<string, unknown>, detail: string): Promise<Outcome> {
  try {
    await api(`/api/missions/${missionId}`, { method: 'PATCH', body });
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Connects an app in the phone's sign-in browser; the server sends the customer straight back. */
export async function connectApp(provider: string): Promise<Outcome | null> {
  const returnTo = Linking.createURL('connected');
  try {
    const { authUrl } = await api<{ authUrl: string }>('/api/composio/connect', { method: 'POST', body: { provider, returnTo } });
    const result = await WebBrowser.openAuthSessionAsync(authUrl, returnTo);
    let message: string | undefined;
    if (result.type === 'success') {
      const { queryParams } = Linking.parse(result.url);
      if (queryParams?.status === 'connected') return { ok: true, detail: 'Agents can use it now.' };
      if (typeof queryParams?.message === 'string') message = queryParams.message;
    }
    // Closed, or the last step didn't come back (lost signal): the server asks Composio whether the
    // connection was made, and records it if so.
    const sync = await api<{ providerConnected?: boolean }>('/api/composio/sync', { method: 'POST', body: { provider } }).catch(() => null);
    if (sync?.providerConnected) return { ok: true, detail: 'Agents can use it now.' };
    if (result.type !== 'success') return null; // closed before connecting
    return { ok: false, error: message ?? 'The connection did not finish.' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function createWebhook(missionId: string): Promise<{ triggerUrl: string; secret: string }> {
  return api('/api/webhooks/manage', { method: 'POST', body: { missionId, label: 'Created from the mobile app' } });
}

export async function goLive(missionId: string): Promise<Outcome> {
  try {
    await api(`/api/missions/${missionId}/graduate`, { method: 'POST', body: {} });
    return { ok: true, detail: 'The next run does the real thing.' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function revertVersion(missionId: string, versionNumber: number): Promise<Outcome> {
  try {
    await api(`/api/missions/${missionId}/revert`, { method: 'POST', body: { versionNumber } });
    return { ok: true, detail: `Back to version ${versionNumber}.` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Queues a mission update; its progress arrives on agent_execution_events under the job id. */
export async function updateMission(missionId: string, request: string, jobId: string): Promise<void> {
  await api(`/api/missions/${missionId}/update-blueprint`, { method: 'POST', body: { request, jobId } });
}

/** Approves or rejects; returns the decision as saved in the mission's chat (also when it was already decided). */
export async function decideApproval(input: { actionId: string; decision: 'approved' | 'rejected'; missionId?: string; reason?: string; via: 'mission_chat' | 'command_center' }): Promise<ApprovalRecordPayload | null> {
  try {
    const res = await api<{ record?: ApprovalRecordPayload }>('/api/approvals', { method: 'POST', body: input });
    return res.record ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.body.record) return err.body.record as ApprovalRecordPayload;
    throw err;
  }
}

/** Builds a failed mission again from the same request; returns the new job's id. */
export async function retryBuild(jobId: string): Promise<string> {
  const res = await api<{ jobId: string }>('/api/blueprint-status/retry', { method: 'POST', body: { jobId } });
  return res.jobId;
}
