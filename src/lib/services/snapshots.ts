import { createServiceClient } from '../supabase/server';

// ============================================================
// State Versioning Service — The Undo Button
// Every successful state transition captures a full JSONB snapshot
// of the entire agentic state (mission + agents + actions).
// ============================================================

export interface MissionSnapshot {
  mission: Record<string, unknown>;
  agents: Record<string, unknown>[];
  proposedActions: Record<string, unknown>[];
  capturedAt: string;
}

/**
 * Capture a full snapshot of the current mission state.
 * Called on every successful state transition.
 */
export async function captureSnapshot(
  missionId: string,
  tenantId: string,
  triggerStatus: string
): Promise<{ version: number }> {
  const supabase = createServiceClient();

  // 1. Fetch current mission state
  const { data: mission, error: missionErr } = await supabase
    .from('missions')
    .select('*')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  if (missionErr || !mission) {
    throw new Error(`Snapshot failed — mission not found: ${missionErr?.message}`);
  }

  // 2. Fetch all agents for this mission
  const { data: agents } = await supabase
    .from('agents')
    .select('*')
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .order('agent_index', { ascending: true });

  // 3. Fetch all proposed actions for this mission
  const { data: actions } = await supabase
    .from('proposed_actions')
    .select('*')
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .order('submitted_at', { ascending: true });

  // 4. Get next version number (max + 1)
  const { data: versionData } = await supabase
    .from('mission_snapshots')
    .select('version')
    .eq('mission_id', missionId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = ((versionData?.version as number) || 0) + 1;

  // 5. Build the snapshot
  const snapshot: MissionSnapshot = {
    mission,
    agents: agents || [],
    proposedActions: actions || [],
    capturedAt: new Date().toISOString(),
  };

  // 6. Insert snapshot
  const { error: snapErr } = await supabase
    .from('mission_snapshots')
    .insert({
      tenant_id: tenantId,
      mission_id: missionId,
      version,
      trigger: triggerStatus,
      snapshot_data: snapshot,
    });

  if (snapErr) {
    throw new Error(`Snapshot insert failed: ${snapErr.message}`);
  }

  // 7. Log event
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'mission.snapshot_captured',
    entity_type: 'mission',
    entity_id: missionId,
    payload: { version, triggerStatus },
  });

  return { version };
}

/**
 * Retrieve a specific snapshot version for a mission.
 */
export async function getSnapshot(
  missionId: string,
  tenantId: string,
  version: number
): Promise<MissionSnapshot | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('mission_snapshots')
    .select('snapshot_data')
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .eq('version', version)
    .single();

  if (error || !data) return null;
  return data.snapshot_data as MissionSnapshot;
}

/**
 * Get the latest snapshot for a mission.
 */
export async function getLatestSnapshot(
  missionId: string,
  tenantId: string
): Promise<{ snapshot: MissionSnapshot; version: number } | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('mission_snapshots')
    .select('snapshot_data, version')
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return { snapshot: data.snapshot_data as MissionSnapshot, version: data.version };
}

/**
 * List all snapshot versions for a mission (metadata only).
 */
export async function listSnapshots(
  missionId: string,
  tenantId: string
): Promise<{ version: number; triggerStatus: string; createdAt: string }[]> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('mission_snapshots')
    .select('version, trigger, created_at')
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .order('version', { ascending: false });

  return (data || []).map((s) => ({
    version: s.version,
    triggerStatus: s.trigger,
    createdAt: s.created_at,
  }));
}

/**
 * Rollback a mission to a previous snapshot version.
 * Restores mission status, agent states, and action states.
 */
export async function rollbackToVersion(
  missionId: string,
  tenantId: string,
  version: number
): Promise<void> {
  const snapshot = await getSnapshot(missionId, tenantId, version);
  if (!snapshot) {
    throw new Error(`Snapshot version ${version} not found for mission ${missionId}`);
  }

  const supabase = createServiceClient();

  // Restore mission state
  const missionData = snapshot.mission;
  await supabase
    .from('missions')
    .update({
      status: missionData.status,
      mission_json: missionData.mission_json,
      validation_report: missionData.validation_report,
      heartbeat_at: new Date().toISOString(),
    })
    .eq('id', missionId)
    .eq('tenant_id', tenantId);

  // Restore agent states
  for (const agent of snapshot.agents) {
    await supabase
      .from('agents')
      .update({ status: agent.status, config: agent.config })
      .eq('id', agent.id as string)
      .eq('tenant_id', tenantId);
  }

  // Log rollback event
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'mission.rolled_back',
    entity_type: 'mission',
    entity_id: missionId,
    payload: { restoredVersion: version },
  });

  // Capture new snapshot of the restored state
  await captureSnapshot(missionId, tenantId, `rollback_to_v${version}`);
}
