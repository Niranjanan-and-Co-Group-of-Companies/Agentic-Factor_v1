import { createServiceClient } from '../supabase/server';
import { captureSnapshot } from './snapshots';

// ============================================================
// Deadlock Detector — Supervisor Service
// Monitors heartbeat timestamps on active missions and
// force-terminates any mission idle beyond its timeout_seconds.
// ============================================================

export interface DeadlockConfig {
  /** How often to poll for deadlocked missions (ms). Default: 30000 */
  pollIntervalMs: number;
  /** Fallback timeout if mission has none configured (s). Default: 300 */
  defaultTimeoutSeconds: number;
  /** Auto-restart attempts before permanent kill. Default: 1 */
  maxRetries: number;
}

const DEFAULT_CONFIG: DeadlockConfig = {
  pollIntervalMs: 30000,
  defaultTimeoutSeconds: 300,
  maxRetries: 1,
};

interface DetectedDeadlock {
  mission_id: string;
  tenant_id: string;
  idle_seconds: number;
  timeout_seconds: number;
}

/**
 * Touch the heartbeat for a mission — called by agents on every action.
 * This resets the deadlock timer.
 */
export async function touchHeartbeat(missionId: string): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('missions')
    .update({ heartbeat_at: new Date().toISOString() })
    .eq('id', missionId);

  if (error) {
    console.error(`[Deadlock] Failed to touch heartbeat for ${missionId}:`, error.message);
  }
}

/**
 * Detect all currently deadlocked missions via the SQL function.
 */
export async function detectDeadlockedMissions(): Promise<DetectedDeadlock[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('detect_deadlocked_missions');

  if (error) {
    console.error('[Deadlock] Detection query failed:', error.message);
    return [];
  }

  return (data as DetectedDeadlock[]) || [];
}

/**
 * Force-terminate a deadlocked mission.
 * 1. Set mission status to 'deadlocked'
 * 2. Terminate all running agents
 * 3. Capture final state snapshot
 * 4. Log the event
 */
export async function terminateDeadlockedMission(
  missionId: string,
  tenantId: string,
  idleSeconds: number
): Promise<void> {
  const supabase = createServiceClient();

  // 1. Update mission status
  const { error: missionErr } = await supabase
    .from('missions')
    .update({
      status: 'deadlocked',
      heartbeat_at: new Date().toISOString(),
    })
    .eq('id', missionId)
    .eq('tenant_id', tenantId);

  if (missionErr) {
    throw new Error(`Failed to deadlock mission ${missionId}: ${missionErr.message}`);
  }

  // 2. Terminate all running/spawning agents
  const { error: agentErr } = await supabase
    .from('agents')
    .update({ status: 'deadlocked' })
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .in('status', ['running', 'spawning', 'paused']);

  if (agentErr) {
    console.error(`[Deadlock] Failed to terminate agents for ${missionId}:`, agentErr.message);
  }

  // 3. Expire all pending actions
  await supabase
    .from('proposed_actions')
    .update({ status: 'expired', decided_at: new Date().toISOString() })
    .eq('mission_id', missionId)
    .eq('tenant_id', tenantId)
    .eq('status', 'pending');

  // 4. Capture final state snapshot before everything shuts down
  await captureSnapshot(missionId, tenantId, 'deadlocked');

  // 5. Log the deadlock event
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'mission.deadlocked',
    entity_type: 'mission',
    entity_id: missionId,
    payload: {
      idleSeconds,
      terminatedAt: new Date().toISOString(),
    },
  });

  console.warn(`[Deadlock] Mission ${missionId} terminated after ${idleSeconds}s idle`);
}

// ============================================================
// Supervisor Loop
// In production this would be a background worker / cron job.
// For the scaffold, we provide start/stop control.
// ============================================================

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the deadlock detector polling loop.
 */
export function startDeadlockDetector(config: Partial<DeadlockConfig> = {}): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (pollTimer) {
    console.warn('[Deadlock] Detector already running');
    return;
  }

  console.log(`[Deadlock] Starting detector — poll every ${cfg.pollIntervalMs}ms, default timeout ${cfg.defaultTimeoutSeconds}s`);

  pollTimer = setInterval(async () => {
    try {
      const deadlocked = await detectDeadlockedMissions();

      for (const d of deadlocked) {
        console.warn(`[Deadlock] Detected: mission=${d.mission_id}, idle=${d.idle_seconds}s, timeout=${d.timeout_seconds}s`);
        await terminateDeadlockedMission(d.mission_id, d.tenant_id, d.idle_seconds);
      }
    } catch (err) {
      console.error('[Deadlock] Supervisor error:', err);
    }
  }, cfg.pollIntervalMs);
}

/**
 * Stop the deadlock detector polling loop.
 */
export function stopDeadlockDetector(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[Deadlock] Detector stopped');
  }
}
