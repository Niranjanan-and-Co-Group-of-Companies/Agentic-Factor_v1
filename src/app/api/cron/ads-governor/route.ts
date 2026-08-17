import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/cron/ads-governor
//
// Runs daily at 7:00 AM IST. Finds every active paid-ads mission
// that has a governor initialized and fires the daily budget/
// performance check for each by calling the governor PATCH handler.
//
// Secured with CRON_SECRET. Schedule in vercel.json:
//   { "path": "/api/cron/ads-governor", "schedule": "30 1 * * *" }
//   (01:30 UTC = 07:00 IST)
// ============================================================

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Find all active governor state entries
  const { data: governorRows, error } = await supabase
    .from('events')
    .select('entity_id, tenant_id, payload')
    .eq('event_type', 'ads.governor.state');

  if (error) {
    console.error('[AdsGovernorCron] DB query failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!governorRows || governorRows.length === 0) {
    return NextResponse.json({ checked: 0, message: 'No active governors found' });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://agenticfactor.io';
  let checkedCount = 0;
  let errorCount = 0;
  const results: Array<{ missionId: string; decision?: string; error?: string }> = [];

  for (const row of governorRows) {
    const payload = row.payload as { status?: string };
    // Skip governors that have already completed or are not active
    if (payload?.status !== 'active') continue;

    const missionId = row.entity_id as string;
    const tenantId = row.tenant_id as string;

    try {
      const res = await fetch(`${appUrl}/api/ads/governor`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cronSecret ?? ''}`,
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify({ missionId }),
        signal: AbortSignal.timeout(45_000),
      });

      if (res.ok) {
        const data = await res.json() as { decision?: string };
        results.push({ missionId, decision: data.decision });
        checkedCount++;
      } else {
        const text = await res.text();
        results.push({ missionId, error: `HTTP ${res.status}: ${text.slice(0, 200)}` });
        errorCount++;
      }
    } catch (err) {
      results.push({ missionId, error: (err as Error).message });
      errorCount++;
    }

    console.log(`[AdsGovernorCron] Checked mission ${missionId} for tenant ${tenantId}`);
  }

  console.log(`[AdsGovernorCron] Done. Checked: ${checkedCount}, Errors: ${errorCount}`);
  return NextResponse.json({ checked: checkedCount, errors: errorCount, results });
}
