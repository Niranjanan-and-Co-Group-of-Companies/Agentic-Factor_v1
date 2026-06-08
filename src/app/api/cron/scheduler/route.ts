import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { executeMission } from '@/lib/services/runtime/executor';

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

        // Re-execute the mission
        executeMission(missionId, tenantId).catch(err => {
          console.error(`[Cron Scheduler] Failed to resume mission ${missionId}:`, err);
        });

        wokeCount++;
      }
    }

    return NextResponse.json({ 
      woke: wokeCount, 
      checked: waitEvents.length,
      message: `Checked ${waitEvents.length} scheduled missions, woke ${wokeCount}` 
    });

  } catch (error) {
    console.error('[Cron Scheduler] Error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
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
function matchesSchedule(config: string | Record<string, any>, now: Date): boolean {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const dayOfWeek = now.getDay(); // 0 = Sunday

  // Handle JSON config objects (custom schedules)
  if (typeof config === 'object' && config !== null) {
    if (config.type === 'custom') {
      // Check day of week (if specified)
      if (config.dayOfWeek && config.dayOfWeek !== 'everyday') {
        const dayMap: Record<string, number> = {
          sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
          thursday: 4, friday: 5, saturday: 6
        };
        const targetDay = dayMap[config.dayOfWeek.toLowerCase()];
        if (targetDay !== undefined && dayOfWeek !== targetDay) return false;
      }

      // Check multiple days of week (if specified as array)
      if (Array.isArray(config.daysOfWeek)) {
        const dayMap: Record<string, number> = {
          sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
          thursday: 4, friday: 5, saturday: 6
        };
        const targetDays = config.daysOfWeek.map((d: string) => dayMap[d.toLowerCase()]).filter((d: number | undefined) => d !== undefined);
        if (targetDays.length > 0 && !targetDays.includes(dayOfWeek)) return false;
      }

      // Check time (HH:MM)
      if (config.time) {
        const [h, m] = config.time.split(':').map(Number);
        if (hour !== h || minute !== m) return false;
      }

      return true;
    }
    
    // Unknown config type
    return false;
  }

  // Handle string presets
  const configStr = String(config);
  
  switch (configStr) {
    case 'every_minute':
      return true;
    case 'every_5_minutes':
      return minute % 5 === 0;
    case 'every_hour':
      return minute === 0;
    case 'daily_9am':
      return hour === 9 && minute === 0;
    case 'daily_6pm':
      return hour === 18 && minute === 0;
    case 'weekly_monday':
      return dayOfWeek === 1 && hour === 9 && minute === 0;
    case 'weekly_friday':
      return dayOfWeek === 5 && hour === 17 && minute === 0;
    default:
      // Try to parse as "HH:MM" format
      const timeMatch = configStr.match(/^(\d{1,2}):(\d{2})$/);
      if (timeMatch) {
        return hour === parseInt(timeMatch[1]) && minute === parseInt(timeMatch[2]);
      }
      return false;
  }
}
