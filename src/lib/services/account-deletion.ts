// Deleting an account. The customer asks (from the app); everything stops at once; for 7 days they can
// change their mind; then a daily job removes it all: the website subscription is cancelled, every app
// connection at Composio is revoked, the account's files and rows are deleted, and finally the login.

import type { SupabaseClient } from '@supabase/supabase-js';

export const GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

/** Storage buckets whose files are kept under "<tenantId>/…". */
export const ACCOUNT_BUCKETS = ['mission-artifacts', 'tenant-uploads', 'agent-images'] as const;

/**
 * Every table holding an account's data, with the column that names the account — children before
 * parents, so nothing is blocked by a reference. Checked against the migrations and the database.
 */
export const ACCOUNT_TABLES: ReadonlyArray<{ table: string; column: 'tenant_id' | 'owner_tenant_id' | 'member_user_id' }> = [
  { table: 'mission_chat_messages', column: 'tenant_id' },
  { table: 'mission_chats', column: 'tenant_id' },
  { table: 'agent_execution_events', column: 'tenant_id' },
  { table: 'approval_history', column: 'tenant_id' },
  { table: 'proposed_actions', column: 'tenant_id' },
  { table: 'clarifications', column: 'tenant_id' },
  { table: 'voice_calls', column: 'tenant_id' },
  { table: 'mission_runs', column: 'tenant_id' },
  { table: 'agent_episodes', column: 'tenant_id' },
  { table: 'agent_profiles', column: 'tenant_id' },
  { table: 'agents', column: 'tenant_id' },
  { table: 'mission_snapshots', column: 'tenant_id' },
  { table: 'mission_tool_schemas', column: 'tenant_id' },
  { table: 'mission_versions', column: 'tenant_id' },
  { table: 'mission_webhooks', column: 'tenant_id' },
  { table: 'permissions', column: 'tenant_id' },
  { table: 'asset_chunks', column: 'tenant_id' },
  { table: 'tenant_assets', column: 'tenant_id' },
  { table: 'mission_members', column: 'owner_tenant_id' },
  { table: 'mission_members', column: 'member_user_id' },
  { table: 'missions', column: 'tenant_id' },
  { table: 'agent_templates', column: 'tenant_id' },
  { table: 'outreach_contacts', column: 'tenant_id' },
  { table: 'tenant_feedback_examples', column: 'tenant_id' },
  { table: 'tenant_memory', column: 'tenant_id' },
  { table: 'tenant_mission_patterns', column: 'tenant_id' },
  { table: 'tenant_permissions', column: 'tenant_id' },
  { table: 'circuit_breaker_state', column: 'tenant_id' },
  { table: 'team_members', column: 'owner_tenant_id' },
  { table: 'team_members', column: 'member_user_id' },
  { table: 'events', column: 'tenant_id' },
  { table: 'tenant_billing', column: 'tenant_id' },
];

export interface DeletionStatus { pending: boolean; requestedAt?: string; deleteAfter?: string }

/** Whether a deletion is pending: the latest request or cancellation decides. */
export async function deletionStatus(supabase: SupabaseClient, tenantId: string): Promise<DeletionStatus> {
  const { data } = await supabase.from('events').select('event_type, payload, created_at')
    .eq('tenant_id', tenantId).in('event_type', ['account.deletion_requested', 'account.deletion_cancelled'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data || data.event_type !== 'account.deletion_requested') return { pending: false };
  const p = data.payload as { deleteAfter?: string };
  return { pending: true, requestedAt: data.created_at as string, deleteAfter: p.deleteAfter };
}

export async function requestDeletion(supabase: SupabaseClient, tenantId: string, email: string, now = Date.now()): Promise<DeletionStatus> {
  const deleteAfter = new Date(now + GRACE_DAYS * DAY_MS).toISOString();
  // What was running and scheduled, so keeping the account puts it back exactly as it was.
  const { data: missions } = await supabase.from('missions').select('id, status, schedule_paused').eq('tenant_id', tenantId);
  const wasActive = (missions ?? []).filter(m => m.status === 'active' || m.status === 'running').map(m => m.id as string);
  const wasScheduled = (missions ?? []).filter(m => !m.schedule_paused).map(m => m.id as string);
  // Nothing runs on the account from now on: schedules stop (the scheduler reads schedule_paused), and
  // the run itself refuses to start while a deletion is pending (see the account-check step).
  await supabase.from('missions').update({ schedule_paused: true, updated_at: new Date(now).toISOString() }).eq('tenant_id', tenantId);
  if (wasActive.length) await supabase.from('missions').update({ status: 'paused' }).eq('tenant_id', tenantId).in('id', wasActive);
  await supabase.from('events').insert({
    tenant_id: tenantId, event_type: 'account.deletion_requested', entity_type: 'account', entity_id: tenantId,
    payload: { email, requestedAt: new Date(now).toISOString(), deleteAfter, wasActive, wasScheduled },
  });
  return { pending: true, requestedAt: new Date(now).toISOString(), deleteAfter };
}

/** Keeps the account: the deletion is cancelled and the missions run and are scheduled as before. */
export async function cancelDeletion(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data: request } = await supabase.from('events').select('event_type, payload')
    .eq('tenant_id', tenantId).in('event_type', ['account.deletion_requested', 'account.deletion_cancelled'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!request || request.event_type !== 'account.deletion_requested') return false;
  await supabase.from('events').insert({
    tenant_id: tenantId, event_type: 'account.deletion_cancelled', entity_type: 'account', entity_id: tenantId, payload: {},
  });
  const p = request.payload as { wasActive?: string[]; wasScheduled?: string[] };
  if (p.wasScheduled?.length) await supabase.from('missions').update({ schedule_paused: false }).eq('tenant_id', tenantId).in('id', p.wasScheduled);
  if (p.wasActive?.length) await supabase.from('missions').update({ status: 'active' }).eq('tenant_id', tenantId).in('id', p.wasActive).eq('status', 'paused');
  return true;
}

/** Accounts whose 7 days have passed without the request being cancelled. */
export async function dueDeletions(supabase: SupabaseClient, now = Date.now(), limit = 10): Promise<string[]> {
  const { data } = await supabase.from('events').select('tenant_id, created_at')
    .eq('event_type', 'account.deletion_requested')
    .lte('created_at', new Date(now - GRACE_DAYS * DAY_MS).toISOString())
    .order('created_at', { ascending: true }).limit(200);
  const due: string[] = [];
  for (const tenantId of [...new Set((data ?? []).map(r => r.tenant_id as string).filter(Boolean))]) {
    const status = await deletionStatus(supabase, tenantId);
    if (status.pending && status.deleteAfter && Date.parse(status.deleteAfter) <= now) due.push(tenantId);
    if (due.length >= limit) break;
  }
  return due;
}

export interface DeletionReport {
  tenantId: string;
  dryRun: boolean;
  subscription: 'none' | 'cancelled' | 'would cancel';
  appConnections: number;
  files: number;
  rows: Record<string, number>;
  login: 'deleted' | 'would delete';
}

export interface DeletionDeps {
  /** Cancels a Razorpay subscription (throws when it can't). */
  cancelSubscription: (subscriptionId: string) => Promise<void>;
  /** Lists and deletes the account's app connections at Composio; returns how many (or would). */
  revokeAppConnections: (tenantId: string, dryRun: boolean) => Promise<number>;
}

async function listFiles(supabase: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error || !data?.length) break;
    for (const item of data) {
      const path = `${prefix}/${item.name}`;
      // Folders have no id: look inside them.
      if (item.id) out.push(path); else out.push(...await listFiles(supabase, bucket, path));
    }
    if (data.length < 1000) break;
  }
  return out;
}

/**
 * Removes the account. Order matters: money and app access first (if either fails, it stops — the
 * account is retried tomorrow rather than deleted with a subscription still charging), then files,
 * rows and the login. With dryRun it only reports what it would remove.
 */
export async function deleteAccount(supabase: SupabaseClient, tenantId: string, deps: DeletionDeps, dryRun = false): Promise<DeletionReport> {
  const report: DeletionReport = { tenantId, dryRun, subscription: 'none', appConnections: 0, files: 0, rows: {}, login: dryRun ? 'would delete' : 'deleted' };

  const { data: billing } = await supabase.from('tenant_billing').select('razorpay_subscription_id').eq('tenant_id', tenantId).maybeSingle();
  const subscriptionId = (billing as { razorpay_subscription_id?: string | null } | null)?.razorpay_subscription_id;
  if (subscriptionId) {
    if (!dryRun) await deps.cancelSubscription(subscriptionId);
    report.subscription = dryRun ? 'would cancel' : 'cancelled';
  }

  report.appConnections = await deps.revokeAppConnections(tenantId, dryRun);

  for (const bucket of ACCOUNT_BUCKETS) {
    const files = await listFiles(supabase, bucket, tenantId);
    report.files += files.length;
    if (!dryRun) {
      for (let i = 0; i < files.length; i += 100) await supabase.storage.from(bucket).remove(files.slice(i, i + 100));
    }
  }

  for (const { table, column } of ACCOUNT_TABLES) {
    const key = column === 'tenant_id' ? table : `${table}.${column}`;
    const { count, error } = dryRun
      ? await supabase.from(table).select('*', { count: 'exact', head: true }).eq(column, tenantId)
      : await supabase.from(table).delete({ count: 'exact' }).eq(column, tenantId);
    if (error) throw new Error(`Could not ${dryRun ? 'count' : 'delete'} ${key}: ${error.message}`);
    report.rows[key] = (report.rows[key] ?? 0) + (count ?? 0);
  }

  if (!dryRun) {
    const { error } = await supabase.auth.admin.deleteUser(tenantId);
    if (error && !/not found/i.test(error.message)) throw new Error(`Could not delete the login: ${error.message}`);
    await supabase.from('events').insert({
      tenant_id: null, event_type: 'account.deleted', entity_type: 'system', entity_id: tenantId,
      payload: { subscription: report.subscription, appConnections: report.appConnections, files: report.files, rows: report.rows },
    });
  }
  return report;
}

/** Revokes every app connection the account has at Composio (where its app logins are stored). */
export async function revokeComposioConnections(tenantId: string, dryRun: boolean): Promise<number> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return 0;
  const base = 'https://backend.composio.dev/api/v3.1/connectedAccounts';
  const headers = { 'x-api-key': apiKey };
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await fetch(`${base}?user_id=${encodeURIComponent(tenantId)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers });
    if (!res.ok) throw new Error(`Composio list failed (${res.status})`);
    const body = await res.json() as { items?: Array<{ id: string }>; next_cursor?: string | null };
    ids.push(...(body.items ?? []).map(i => i.id));
    cursor = body.next_cursor ?? undefined;
  } while (cursor);
  if (!dryRun) {
    for (const id of ids) {
      const res = await fetch(`${base}/${id}`, { method: 'DELETE', headers });
      if (!res.ok && res.status !== 404) throw new Error(`Composio delete failed (${res.status})`);
    }
  }
  return ids.length;
}
