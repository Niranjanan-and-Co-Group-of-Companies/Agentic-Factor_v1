import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { applyStoreEvent, type StoreEvent } from '@/lib/services/store-billing';

// ============================================================
// POST /api/revenuecat/webhook
// App Store and Google Play purchases, renewals, cancellations, expiries and refunds, sent by
// RevenueCat. Authenticated by the Authorization header set in RevenueCat (REVENUECAT_WEBHOOK_AUTH).
// A failure answers 500 so RevenueCat sends the event again; each payment is applied once.
// ============================================================

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) {
    console.error('[RevenueCat Webhook] REVENUECAT_WEBHOOK_AUTH is not set');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  const given = request.headers.get('authorization') ?? '';
  if (!sameSecret(given, expected) && !sameSecret(given, `Bearer ${expected}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let event: StoreEvent | undefined;
  try {
    event = ((await request.json()) as { event?: StoreEvent }).event;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!event?.id || !event.type) return NextResponse.json({ error: 'No event' }, { status: 400 });

  try {
    const sandboxTenants = (process.env.REVENUECAT_SANDBOX_TENANTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const outcome = await applyStoreEvent(createServiceClient(), event, { sandboxTenants });
    console.log(`[RevenueCat Webhook] ${event.type} ${event.product_id ?? ''} → ${outcome.result}${outcome.reason ? ` (${outcome.reason})` : ''}`);
    return NextResponse.json({ received: true, ...outcome });
  } catch (error) {
    console.error('[RevenueCat Webhook] Error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
