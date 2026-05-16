import { createServiceClient } from '../supabase/server';
import { captureSnapshot } from './snapshots';
import { touchHeartbeat, startDeadlockDetector } from './deadlock-detector';
import { executeDryRun, type DryRunReport } from '../middleware/dry-run';
import type { Mission, AgentDefinition } from '../schemas/mission';

// ============================================================
// Agent Orchestrator — The Core Engine (v3)
//
// Responsibilities:
// 1. Lazy provisioning — create DB rows only at initMission()
// 2. Dynamic 1-N agent spawning from Mission JSON
// 3. Snapshot on every state transition
// 4. Heartbeat integration for deadlock detection
// 5. Dry run of first execution cycle
// ============================================================

// ============================================================
// Types
// ============================================================

export type AgentStatus =
  | 'inactive'
  | 'spawning'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'terminated'
  | 'deadlocked';

export type MissionStatus =
  | 'draft'
  | 'pending_permissions'
  | 'pending_validation'
  | 'pending_approval'
  | 'building'
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'deadlocked';

export interface ProvisionedAgent {
  id: string;
  missionId: string;
  tenantId: string;
  role: string;
  agentIndex: number;
  status: AgentStatus;
  capabilities: string[];
  requiresExternalData: boolean;
  systemPrompt: string;
  config: Record<string, unknown>;
  hasResearchLog: boolean;
}

export interface OrchestrationGraph {
  missionId: string;
  tenantId: string;
  pattern: string;
  timeoutSeconds: number;
  agents: ProvisionedAgent[];
  edges: { from: string; to: string; condition?: string }[];
  entryAgentId: string;
}

export interface BuildTeamResult {
  graph: OrchestrationGraph;
  dryRunReport: DryRunReport;
  snapshotVersion: number;
}

// ============================================================
// State Transition — with snapshot + heartbeat
// ============================================================

/**
 * Transition a mission to a new status.
 * EVERY transition triggers: heartbeat touch + state snapshot.
 */
export async function transitionMissionStatus(
  missionId: string,
  tenantId: string,
  newStatus: MissionStatus
): Promise<{ snapshotVersion: number }> {
  const supabase = createServiceClient();

  // 1. Update mission status + heartbeat
  const { error } = await supabase
    .from('missions')
    .update({
      status: newStatus,
      heartbeat_at: new Date().toISOString(),
    })
    .eq('id', missionId)
    .eq('tenant_id', tenantId);

  if (error) {
    throw new Error(`Failed to transition mission ${missionId} to ${newStatus}: ${error.message}`);
  }

  // 2. Touch heartbeat (redundant with above, but ensures the function is exercised)
  await touchHeartbeat(missionId);

  // 3. Capture snapshot
  const { version } = await captureSnapshot(missionId, tenantId, newStatus);

  // 4. Log state transition event
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'mission.status_changed',
    entity_type: 'mission',
    entity_id: missionId,
    payload: { newStatus, snapshotVersion: version },
  });

  return { snapshotVersion: version };
}

/**
 * Transition an agent to a new status + touch mission heartbeat.
 */
export async function transitionAgentStatus(
  agentId: string,
  missionId: string,
  tenantId: string,
  newStatus: AgentStatus
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('agents')
    .update({ status: newStatus })
    .eq('id', agentId)
    .eq('tenant_id', tenantId);

  if (error) {
    throw new Error(`Failed to transition agent ${agentId} to ${newStatus}: ${error.message}`);
  }

  // Every agent action touches the mission heartbeat
  await touchHeartbeat(missionId);

  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'agent.status_changed',
    entity_type: 'agent',
    entity_id: agentId,
    payload: { missionId, newStatus },
  });
}

// ============================================================
// Lazy Provisioning — initMission()
// Creates agent rows, research logs, and history storage
// ONLY when a mission is initialized for a specific tenant_id.
// No pre-allocated resources.
// ============================================================

/**
 * Provision all agent rows for a mission. Called once at build time.
 * This is the "lazy provisioning" entry point.
 */
export async function provisionAgentRows(
  agents: AgentDefinition[],
  tenantId: string,
  missionId: string
): Promise<ProvisionedAgent[]> {
  const supabase = createServiceClient();
  const provisioned: ProvisionedAgent[] = [];

  // Agents are now inserted and UUID-assigned during `persistMission`.
  // We no longer need to insert them here, just prepare the provisioned objects.


  // Build provisioned agent objects and create research logs where needed
  for (const agent of agents) {
    let hasResearchLog = false;

    if (agent.requiresExternalData) {
      hasResearchLog = await provisionResearchLog(agent.id, tenantId, missionId);
    }

    provisioned.push({
      id: agent.id,
      missionId,
      tenantId,
      role: agent.role,
      agentIndex: agent.agentIndex,
      status: 'inactive',
      capabilities: agent.capabilities,
      requiresExternalData: agent.requiresExternalData,
      systemPrompt: agent.systemPrompt,
      config: { tools: agent.tools },
      hasResearchLog,
    });
  }

  return provisioned;
}

/**
 * Provision a research log entry for an agent that requires external data.
 * Stored as an event so it's part of the audit trail.
 */
async function provisionResearchLog(
  agentId: string,
  tenantId: string,
  missionId: string
): Promise<boolean> {
  const supabase = createServiceClient();

  const { error } = await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'agent.research_log_provisioned',
    entity_type: 'agent',
    entity_id: agentId,
    payload: {
      missionId,
      provisionedAt: new Date().toISOString(),
      status: 'awaiting_data',
    },
  });

  if (error) {
    console.error(`[Orchestrator] Failed to provision research log for agent ${agentId}:`, error.message);
    return false;
  }

  return true;
}

// ============================================================
// Spawn Agents — Dynamic 1-N
// ============================================================

/**
 * Spawn a single agent — transition from 'inactive' to 'spawning' to 'running'.
 */
async function spawnAgent(
  agent: ProvisionedAgent,
  missionId: string,
  tenantId: string
): Promise<ProvisionedAgent> {
  // Transition to spawning
  await transitionAgentStatus(agent.id, missionId, tenantId, 'spawning');

  // In a real system, this is where you'd:
  // - Load the agent's system prompt
  // - Initialize its tool connections
  // - Set up its message queue
  // - Attach research module if requiresExternalData
  // For now, we simulate the spawn

  // Transition to running
  await transitionAgentStatus(agent.id, missionId, tenantId, 'running');

  return { ...agent, status: 'running' };
}

// ============================================================
// Wire Orchestration Graph
// ============================================================

function wireGraph(
  agents: ProvisionedAgent[],
  mission: Mission
): OrchestrationGraph {
  return {
    missionId: mission.id,
    tenantId: mission.tenantId,
    pattern: mission.orchestration.pattern,
    timeoutSeconds: mission.orchestration.timeoutSeconds,
    agents,
    edges: mission.orchestration.edges,
    entryAgentId: mission.orchestration.entryAgent,
  };
}

// ============================================================
// Main Entry Point: buildTeam()
// ============================================================

/**
 * Build a complete agent team from a Mission JSON.
 *
 * Flow:
 * 1. Transition mission to 'building'
 * 2. Lazy-provision all agent rows + research logs
 * 3. Spawn 1-N agents dynamically
 * 4. Wire orchestration graph
 * 5. Capture 'building' snapshot
 * 6. Execute dry run
 * 7. Start heartbeat monitor
 * 8. Transition to 'active' (or 'failed' if dry run fails)
 */
export async function buildTeam(
  mission: Mission,
  tenantId: string
): Promise<BuildTeamResult> {
  // ── Step 1: Transition to 'building' ──
  await transitionMissionStatus(mission.id, tenantId, 'building');

  // ── Step 2: Lazy-provision agent rows ──
  const provisionedAgents = await provisionAgentRows(
    mission.agents,
    tenantId,
    mission.id
  );

  // ── Step 3: Spawn 1-N agents dynamically ──
  const spawnedAgents: ProvisionedAgent[] = [];
  for (const agent of provisionedAgents) {
    const spawned = await spawnAgent(agent, mission.id, tenantId);
    spawnedAgents.push(spawned);
  }

  // ── Step 4: Wire orchestration graph ──
  const graph = wireGraph(spawnedAgents, mission);

  // ── Step 5: Capture 'building' snapshot (agents now exist) ──
  const { version: buildSnapshotVersion } = await captureSnapshot(
    mission.id,
    tenantId,
    'building_complete'
  );

  // ── Step 6: Execute dry run ──
  const dryRunReport = await executeDryRun(mission, tenantId);

  if (!dryRunReport.success) {
    // Dry run failed — transition to 'failed' and abort
    await transitionMissionStatus(mission.id, tenantId, 'failed');

    return {
      graph,
      dryRunReport,
      snapshotVersion: buildSnapshotVersion,
    };
  }

  // ── Step 7: Start heartbeat monitor ──
  // The deadlock detector is a global singleton — ensure it's running
  startDeadlockDetector();

  // ── Step 8: Transition to 'active' ──
  const { snapshotVersion } = await transitionMissionStatus(
    mission.id,
    tenantId,
    'active'
  );

  return {
    graph,
    dryRunReport,
    snapshotVersion,
  };
}

// ============================================================
// Query helpers
// ============================================================

/**
 * Get all agents for a mission.
 */
export async function getMissionAgents(
  missionId: string,
  tenantId: string
): Promise<ProvisionedAgent[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .order('agent_index', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch agents: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    missionId: row.mission_id,
    tenantId: row.tenant_id,
    role: row.role,
    agentIndex: row.agent_index,
    status: row.status as AgentStatus,
    capabilities: row.capabilities || [],
    requiresExternalData: row.requires_external_data || false,
    systemPrompt: row.system_prompt || '',
    config: row.config || {},
    hasResearchLog: row.requires_external_data || false,
  }));
}

/**
 * Get mission with full agent details.
 */
export async function getMissionWithAgents(
  missionId: string,
  tenantId: string
): Promise<{
  mission: Record<string, unknown>;
  agents: ProvisionedAgent[];
} | null> {
  const supabase = createServiceClient();

  const { data: mission, error } = await supabase
    .from('missions')
    .select('*')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !mission) return null;

  const agents = await getMissionAgents(missionId, tenantId);

  return { mission, agents };
}
