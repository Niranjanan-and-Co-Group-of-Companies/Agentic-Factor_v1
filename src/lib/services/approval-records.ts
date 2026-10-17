// What an approval asks for, in plain words, and the permanent record of the decision that is saved
// into the mission's chat — wherever the decision was made (the mission chat, the Command Center,
// a reply in the chat), so the mission's history always shows what was approved or rejected and why.

import type { SupabaseClient } from '@supabase/supabase-js';
import { humanizeAction } from '@/lib/utils/app-name';

export type ApprovalKind = 'rehearsal' | 'live';
export type ApprovalVia = 'mission_chat' | 'command_center' | 'chat_message' | 'approvals_page' | 'api';

export interface ApprovalSummary {
  id: string;
  missionId: string;
  missionTitle: string;
  agentId: string;
  agentRole: string;
  kind: ApprovalKind;
  /** The app actions it will run, e.g. "Gmail: send email". */
  actions: string[];
  /** The platform's own description of the calls and the prepared content. */
  preview: string;
  runId?: string;
  submittedAt?: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface ApprovalRecordPayload {
  type: 'approval_record';
  actionId: string;
  decision: 'approved' | 'rejected';
  kind: ApprovalKind;
  agentRole: string;
  actions: string[];
  preview?: string;
  reason?: string;
  via: ApprovalVia;
  decidedBy?: string;
  decidedAt: string;
  runId?: string;
}

export interface ProposedActionRow {
  id: string;
  mission_id: string;
  agent_id?: string | null;
  agent_role?: string | null;
  mission_title?: string | null;
  action_type?: string | null;
  status?: string | null;
  submitted_at?: string | null;
  payload?: Record<string, unknown> | null;
  payload_redacted?: { actions?: string[]; preview?: string } | null;
}

export const VIA_LABEL: Record<ApprovalVia, string> = {
  mission_chat: 'in the mission chat',
  command_center: 'in Command Center',
  chat_message: 'by replying in the chat',
  approvals_page: 'on the Approvals page',
  api: 'through the API',
};

/** Composio toolkit slugs a mission declares, so action names split into app and verb correctly. */
export function missionToolkits(missionJson: unknown): string[] {
  const perms = ((missionJson as { permissions?: Array<{ type?: string; service?: string }> } | null)?.permissions ?? []);
  return [...new Set(perms.filter(p => p.type === 'composio_oauth' && p.service).map(p => p.service!.toLowerCase()))];
}

/** How an action slug is shown: the mission catalog's official label on the server, a readable fallback otherwise. */
export type ActionLabeler = (slug: string) => string;
export const fallbackLabeler = (toolkits: string[] = []): ActionLabeler => slug => (/^[A-Z0-9_]+$/.test(slug) ? humanizeAction(slug, toolkits) : slug);

/** Action slugs an approval asks to run (for looking up their official titles first). */
export function approvalActionSlugs(row: Pick<ProposedActionRow, 'payload_redacted'>): string[] {
  return (row.payload_redacted?.actions ?? []).filter(a => /^[A-Z0-9_]+$/.test(a));
}

/** A proposed action as the customer should see it. */
export function describeApproval(row: ProposedActionRow, label: ActionLabeler = fallbackLabeler(), previewLimit = 4000): ApprovalSummary {
  const redacted = row.payload_redacted ?? {};
  const actions = (redacted.actions ?? []).slice(0, 8).map(label);
  const status = row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending';
  return {
    id: row.id,
    missionId: row.mission_id,
    missionTitle: row.mission_title || 'Mission',
    agentId: row.agent_id ?? '',
    agentRole: row.agent_role || 'An agent',
    kind: row.action_type === 'training_review' ? 'rehearsal' : 'live',
    actions,
    preview: typeof redacted.preview === 'string' ? redacted.preview.slice(0, previewLimit) : '',
    runId: typeof row.payload?.runId === 'string' ? row.payload.runId : undefined,
    submittedAt: row.submitted_at ?? undefined,
    status,
  };
}

/** The decision as one line of chat history (what the assistant and anyone scrolling back will read). */
export function decisionText(r: ApprovalRecordPayload): string {
  const what = r.actions.length ? r.actions.join(', ') : 'its prepared changes';
  const head = r.decision === 'approved'
    ? (r.kind === 'rehearsal' ? 'Approved the rehearsal preview' : 'Approved')
    : (r.kind === 'rehearsal' ? 'Rejected the rehearsal preview' : 'Rejected');
  const when = new Date(r.decidedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const who = r.decidedBy ? ` by ${r.decidedBy}` : '';
  const reason = r.reason ? ` Reason: “${r.reason}”.` : '';
  return `${r.decision === 'approved' ? '✅' : '⛔'} ${head} — ${r.agentRole}: ${what}.${reason} (Decided${who} ${VIA_LABEL[r.via]}, ${when} IST.)`;
}

/**
 * Saves the decision into the mission's most recent chat (creating one when the mission has none) and
 * moves that chat to the top, so the mission chat opens on it. Never throws: the decision itself stands.
 */
export async function recordDecisionInChat(
  supabase: SupabaseClient,
  tenantId: string,
  missionId: string,
  record: ApprovalRecordPayload,
): Promise<string | null> {
  const { saveToMissionChat } = await import('@/lib/services/chat-log');
  return saveToMissionChat(supabase, tenantId, missionId, record, decisionText(record));
}

/** The saved record of a decided action, rebuilt from the action row (for views that missed the moment). */
export function recordFromRow(row: ProposedActionRow, label: ActionLabeler = fallbackLabeler()): ApprovalRecordPayload | null {
  if (row.status !== 'approved' && row.status !== 'rejected') return null;
  const d = (row.payload?.decision ?? {}) as { reason?: string; via?: ApprovalVia; by?: string; at?: string };
  const summary = describeApproval(row, label, 1500);
  return {
    type: 'approval_record',
    actionId: row.id,
    decision: row.status,
    kind: summary.kind,
    agentRole: summary.agentRole,
    actions: summary.actions,
    preview: summary.preview || undefined,
    reason: d.reason,
    via: d.via ?? 'api',
    decidedBy: d.by,
    decidedAt: d.at ?? new Date().toISOString(),
    runId: summary.runId,
  };
}
