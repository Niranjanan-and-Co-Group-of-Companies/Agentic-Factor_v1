import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';

// ============================================================
// Cron Scheduler — Wakes up paused/scheduled missions
// Called every minute by Vercel Cron or external cron service.
// Secured with CRON_SECRET header.
// Supports: presets (daily_9am), custom JSON configs (day + time + endDate + maxRuns)
// ============================================================

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    // 1. Find all missions with pending schedule/wake events
    const { data: waitEvents, error } = await supabase
      .from('events')
      .select('entity_id, tenant_id, payload, created_at')
      .eq('event_type', 'mission.wait')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[Cron Scheduler] Failed to query wait events:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!waitEvents || waitEvents.length === 0) {
      return NextResponse.json({ woke: 0, message: 'No scheduled missions found' });
    }

    const now = new Date();
    let wokeCount = 0;

    for (const event of waitEvents) {
      const { entity_id: missionId, tenant_id: tenantId, payload } = event;

      if (!payload || !missionId || !tenantId) continue;

      // Check if this mission is still paused (might have been manually resumed)
      const { data: mission } = await supabase
        .from('missions')
        .select('status')
        .eq('id', missionId)
        .eq('tenant_id', tenantId)
        .single();

      if (!mission || mission.status !== 'paused') {
        // Mission is no longer paused — clean up the wait event
        await supabase
          .from('events')
          .delete()
          .eq('entity_id', missionId)
          .eq('event_type', 'mission.wait');
        continue;
      }

      let shouldWake = false;

      if (payload.action === 'sleep') {
        // Simple delay: check if enough time has passed
        const config = payload.config as string;
        const eventCreated = new Date(event.created_at || now);
        const delayMs = parseDuration(config);
        
        if (delayMs > 0 && now.getTime() - eventCreated.getTime() >= delayMs) {
          shouldWake = true;
        }
      } else if (payload.action === 'schedule') {
        const config = payload.config;
        
        // Check max runs limit before evaluating schedule
        if (typeof config === 'object' && config !== null && config.maxRuns) {
          const { count: runCount } = await supabase
            .from('events')
            .select('*', { count: 'exact', head: true })
            .eq('entity_id', missionId)
            .eq('event_type', 'mission.resumed_by_cron');
          
          if (runCount !== null && runCount >= config.maxRuns) {
            console.log(`[Cron Scheduler] Mission ${missionId} reached max runs (${runCount}/${config.maxRuns}). Auto-unscheduling.`);
            // Auto-unschedule: remove wait event
            await supabase.from('events').delete()
              .eq('entity_id', missionId).eq('event_type', 'mission.wait');
            // Mark as completed
            await supabase.from('missions').update({ status: 'completed' }).eq('id', missionId);
            continue;
          }
        }
        
        // Check end date before evaluating schedule
        if (typeof config === 'object' && config !== null && config.endDate) {
          const endDate = new Date(config.endDate);
          if (now > endDate) {
            console.log(`[Cron Scheduler] Mission ${missionId} past end date (${config.endDate}). Auto-unscheduling.`);
            await supabase.from('events').delete()
              .eq('entity_id', missionId).eq('event_type', 'mission.wait');
            await supabase.from('missions').update({ status: 'completed' }).eq('id', missionId);
            continue;
          }
        }
        
        // Evaluate if current time matches the schedule
        shouldWake = matchesSchedule(config, now);
      }

      if (shouldWake) {
        // ── Check billing before waking ──
        const { checkCredits, deductCredits, CREDIT_COSTS, getPlanConfig } = await import('@/lib/middleware/billing');
        const planConfig = await getPlanConfig(tenantId);
        
        // Block free plan from scheduling
        if (!planConfig.schedulingEnabled) {
          console.log(`[Cron Scheduler] Skipping mission ${missionId} — free plan, scheduling disabled.`);
          await supabase.from('events').delete()
            .eq('entity_id', missionId).eq('event_type', 'mission.wait');
          continue;
        }

        // Check if tenant has credits for schedule maintenance + execution
        const creditCheck = await checkCredits(tenantId, CREDIT_COSTS.schedule_daily);
        if (!creditCheck.allowed) {
          console.log(`[Cron Scheduler] Skipping mission ${missionId} — insufficient credits.`);
          // Record the skip so it's visible in the audit log and can trigger a notification
          supabase.from('events').insert({
            tenant_id: tenantId,
            event_type: 'mission.schedule_skipped',
            entity_type: 'mission',
            entity_id: missionId,
            payload: {
              reason: 'insufficient_credits',
              creditsRemaining: creditCheck.creditsRemaining ?? 0,
              skippedAt: now.toISOString(),
            },
          }).then(() => {}, () => {});
          // Notify the tenant that their scheduled mission couldn't run
          try {
            const { notifyMissionStatus } = await import('@/lib/services/notifications');
            await notifyMissionStatus(tenantId, missionId, missionId, 'paused');
          } catch { /* non-fatal */ }
          continue;
        }

        // Deduct schedule maintenance credit
        await deductCredits(tenantId, CREDIT_COSTS.schedule_daily, `schedule_maintenance:${missionId}`).catch(() => {});

        console.log(`[Cron Scheduler] Waking mission ${missionId} (${payload.action}: ${typeof payload.config === 'object' ? JSON.stringify(payload.config) : payload.config})`);
        
        // Transition mission back to active
        await supabase
          .from('missions')
          .update({ status: 'active', heartbeat_at: now.toISOString() })
          .eq('id', missionId);

        // Log the wake event
        await supabase.from('events').insert({
          tenant_id: tenantId,
          event_type: 'mission.resumed_by_cron',
          entity_type: 'mission',
          entity_id: missionId,
          payload: { previousAction: payload.action, config: payload.config, wokeAt: now.toISOString() },
        });

        // Remove the wait event for one-time schedules only
        if (payload.action !== 'schedule') {
          await supabase
            .from('events')
            .delete()
            .eq('entity_id', missionId)
            .eq('event_type', 'mission.wait');
        }

        // Fire Inngest event — runs in background, no Vercel timeout risk.
        // Pass a pre-generated runId so the mission_runs row ties to this execution.
        const runId = crypto.randomUUID();
        await inngest.send({
          name: 'mission.execute',
          data: { missionId, tenantId, runId, trigger: 'scheduled' },
        }).catch((err: unknown) => {
          console.error(`[Cron Scheduler] Failed to fire Inngest for mission ${missionId}:`, err);
        });

        wokeCount++;
      }
    }

    // ── Ads Governor: run daily checks for active paid-ads missions ──
    const governorChecked = await runAdsGovernorChecks(now);

    return NextResponse.json({
      woke: wokeCount,
      checked: waitEvents.length,
      adsGovernorChecked: governorChecked,
      message: `Checked ${waitEvents.length} scheduled missions, woke ${wokeCount}; ads governor checked ${governorChecked} missions`
    });

  } catch (error) {
    console.error('[Cron Scheduler] Error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// ── Ads Governor: daily performance check for paid-ads missions ──

async function runAdsGovernorChecks(now: Date): Promise<number> {
  // Only run once per day — at 8am UTC (before business hours)
  if (now.getHours() !== 8 || now.getMinutes() !== 0) return 0;

  const supabase = createServiceClient();

  // Find all missions that have an active ads governor state
  const { data: governorEvents } = await supabase
    .from('events')
    .select('entity_id, tenant_id, payload')
    .eq('event_type', 'ads.governor.state');

  if (!governorEvents || governorEvents.length === 0) return 0;

  let checked = 0;
  for (const ev of governorEvents) {
    const state = ev.payload as { status?: string; lastCheckAt?: string } | null;
    if (!state || state.status !== 'active') continue;

    // Skip if already checked today
    const lastCheck = state.lastCheckAt ? new Date(state.lastCheckAt) : null;
    if (lastCheck && lastCheck.toISOString().split('T')[0] === now.toISOString().split('T')[0]) continue;

    // Fire governor PATCH via internal fetch — reuse the route logic
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      await fetch(`${baseUrl}/api/ads/governor`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          // Pass cron secret as Authorization so the governor can identify this as an internal call
          Authorization: `Bearer ${process.env.CRON_SECRET ?? 'internal'}`,
          'x-tenant-id': ev.tenant_id,
        },
        body: JSON.stringify({ missionId: ev.entity_id }),
      });
      checked++;
    } catch (err) {
      console.warn(`[Ads Governor Cron] Failed to check mission ${ev.entity_id}:`, err);
    }
  }

  return checked;
}

// ── Helpers ──

function parseDuration(config: string): number {
  const match = config.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 0;
  const value = parseInt(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] || 0);
}

/**
 * Match a schedule config against the current time.
 * Supports:
 *   - String presets: "every_minute", "every_5_minutes", "every_hour", "daily_9am", etc.
 *   - "HH:MM" format: "14:30" → runs daily at 14:30
 *   - JSON custom config: { type: "custom", dayOfWeek: "friday", time: "12:30", endDate: "...", maxRuns: 3 }
 */
const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * Convert a UTC Date to the customer's local time using their timezone.
 * Falls back to UTC if the timezone is invalid or missing.
 */
function toLocalTime(utcNow: Date, timezone?: string): { hour: number; minute: number; dayOfWeek: number } {
  if (timezone) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric', minute: 'numeric', weekday: 'short',
        hour12: false,
      });
      const parts = formatter.formatToParts(utcNow);
      const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0');
      const weekday = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() ?? '';
      const dayAbbrevMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      return {
        hour: get('hour'),
        minute: get('minute'),
        dayOfWeek: dayAbbrevMap[weekday.slice(0, 3)] ?? utcNow.getDay(),
      };
    } catch {
      // Invalid timezone string — fall through to UTC
    }
  }
  return { hour: utcNow.getHours(), minute: utcNow.getMinutes(), dayOfWeek: utcNow.getDay() };
}

/**
 * Match a schedule config against the current time.
 * Supports:
 *   - String presets: "every_minute", "every_5_minutes", "every_hour", "daily_9am", etc.
 *   - "HH:MM" format: "14:30" → runs daily at 14:30
 *   - JSON custom config: { type: "custom", dayOfWeek?: string, daysOfWeek?: string[],
 *       time: "HH:MM", timezone?: string, endDate?: string, maxRuns?: number }
 */
function matchesSchedule(config: string | Record<string, any>, now: Date): boolean {
  // Handle JSON config objects (custom schedules)
  if (typeof config === 'object' && config !== null) {
    if (config.type === 'custom') {
      const local = toLocalTime(now, config.timezone);
      const { hour, minute, dayOfWeek } = local;

      // Check single day of week
      if (config.dayOfWeek && config.dayOfWeek !== 'everyday') {
        const targetDay = DAY_MAP[config.dayOfWeek.toLowerCase()];
        if (targetDay !== undefined && dayOfWeek !== targetDay) return false;
      }

      // Check multiple days of week (array — e.g. ["sunday", "monday"])
      if (Array.isArray(config.daysOfWeek) && config.daysOfWeek.length > 0) {
        const targetDays = config.daysOfWeek
          .map((d: string) => DAY_MAP[d.toLowerCase()])
          .filter((d: number | undefined) => d !== undefined) as number[];
        if (targetDays.length > 0 && !targetDays.includes(dayOfWeek)) return false;
      }

      // Check time (HH:MM) in customer's local timezone
      if (config.time) {
        const [h, m] = config.time.split(':').map(Number);
        if (hour !== h || minute !== m) return false;
      }

      return true;
    }
    return false;
  }

  // String presets always run in server time (UTC) — acceptable for system presets
  const configStr = String(config);
  const hour = now.getHours();
  const minute = now.getMinutes();
  const dayOfWeek = now.getDay();

  switch (configStr) {
    case 'every_minute':      return true;
    case 'every_5_minutes':   return minute % 5 === 0;
    case 'every_hour':        return minute === 0;
    case 'daily_9am':         return hour === 9 && minute === 0;
    case 'daily_6pm':         return hour === 18 && minute === 0;
    case 'weekly_monday':     return dayOfWeek === 1 && hour === 9 && minute === 0;
    case 'weekly_friday':     return dayOfWeek === 5 && hour === 17 && minute === 0;
    default: {
      const timeMatch = configStr.match(/^(\d{1,2}):(\d{2})$/);
      if (timeMatch) return hour === parseInt(timeMatch[1]) && minute === parseInt(timeMatch[2]);
      return false;
    }
  }
}
