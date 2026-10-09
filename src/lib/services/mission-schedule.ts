/**
 * A mission's schedule as the scheduler sees it: the `mission.wait` event written by the
 * schedule action (payload.config = { cron, timezone }) plus missions.schedule_paused.
 *
 * Command Center and mission chat used to have no reliable view of this (mission chat read a
 * mission_schedules table nothing writes to), so Command Center told a customer a mission was
 * "already scheduled" when it had only proposed the schedule.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MissionSchedule { cron: string; timezone: string; paused: boolean }

export async function getMissionSchedules(
  supabase: SupabaseClient,
  tenantId: string,
  missionIds: string[],
): Promise<Map<string, MissionSchedule>> {
  const schedules = new Map<string, MissionSchedule>();
  if (missionIds.length === 0) return schedules;
  const [{ data: waits }, { data: missions }] = await Promise.all([
    supabase.from('events').select('entity_id, payload')
      .eq('tenant_id', tenantId).eq('event_type', 'mission.wait').in('entity_id', missionIds),
    supabase.from('missions').select('id, schedule_paused').eq('tenant_id', tenantId).in('id', missionIds),
  ]);
  const paused = new Map((missions ?? []).map((m: { id: string; schedule_paused?: boolean | null }) => [m.id, !!m.schedule_paused]));
  for (const w of (waits ?? []) as Array<{ entity_id: string; payload: { config?: { cron?: string; timezone?: string } } }>) {
    const cron = w.payload?.config?.cron;
    if (!cron) continue;
    schedules.set(w.entity_id, { cron, timezone: w.payload.config?.timezone ?? 'Asia/Kolkata', paused: paused.get(w.entity_id) ?? false });
  }
  return schedules;
}

export function describeSchedule(s: MissionSchedule | undefined): string {
  if (!s) return 'not scheduled';
  return `scheduled "${s.cron}" (${s.timezone})${s.paused ? ', paused' : ''}`;
}
