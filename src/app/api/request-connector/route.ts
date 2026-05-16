import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { notifyConnectorRequest } from '@/lib/services/notifications';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// POST /api/request-connector
// Sends an email to admin via SMTP2GO + logs to Supabase
// ============================================================
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  const tenantId = isAuthError(authResult) ? 'anonymous' : authResult.tenantId;

  try {
    const { connectorId, connectorLabel, userEmail } = await request.json();

    if (!connectorId || !connectorLabel) {
      return NextResponse.json({ error: 'Missing connectorId or connectorLabel' }, { status: 400 });
    }

    // 1. Send notification email
    await notifyConnectorRequest(connectorId, connectorLabel, tenantId, userEmail);

    // 2. Log to Supabase events table
    if (tenantId !== 'anonymous') {
      const supabase = createServiceClient();
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'connector.requested',
        entity_type: 'connector',
        entity_id: connectorId,
        payload: { connectorLabel, userEmail, requestedAt: new Date().toISOString() },
      });
    }

    return NextResponse.json({ success: true, message: `Request for ${connectorLabel} submitted` });
  } catch (error) {
    console.error('[POST /api/request-connector] Error:', (error as Error).message);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
