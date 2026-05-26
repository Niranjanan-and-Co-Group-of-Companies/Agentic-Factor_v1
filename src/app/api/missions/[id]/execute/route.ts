import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { inngest } from '@/lib/inngest/client';

export const maxDuration = 60; // Only needs to be long enough to send the event

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    const { verifyMissionPermissions } = await import('@/lib/services/oauth-refresher');
    
    // Check if we have the required tokens
    const missingProviders = await verifyMissionPermissions(missionId, tenantId);
    
    if (missingProviders.length > 0) {
      // Email the admin about missing connectors
      try {
        const { createServiceClient } = await import('@/lib/supabase/server');
        const supabase = createServiceClient();
        
        // Get mission title for the email
        const { data: missionData } = await supabase
          .from('missions')
          .select('mission_json')
          .eq('id', missionId)
          .eq('tenant_id', tenantId)
          .single();
        
        // Get customer email
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('owner_email')
          .eq('id', tenantId)
          .single();
        
        const missionTitle = missionData?.mission_json?.title || 'Unknown Mission';
        const customerEmail = tenantData?.owner_email || 'unknown';
        
        // Send admin notification
        const { notifyAdminMissingConnectors } = await import('@/lib/services/email-notifications');
        await notifyAdminMissingConnectors(missionId, missionTitle, customerEmail, missingProviders);
        console.log(`[Execute] Admin notified about missing connectors: ${missingProviders.join(', ')}`);
      } catch (emailErr) {
        console.error('[Execute] Failed to send admin notification:', emailErr);
      }

      return NextResponse.json(
        { 
          error: 'missing_permission', 
          providers: missingProviders,
          message: `This mission requires connectors that aren't configured yet: ${missingProviders.join(', ')}. Our team has been notified and will set them up. You'll receive an email once they're ready.`
        }, 
        { status: 403 }
      );
    }

    // --- CLEAR CACHE FOR FRESH RUNS ---
    const { createServiceClient } = await import('@/lib/supabase/server');
    const supabase = createServiceClient();
    
    const { data: missionData } = await supabase
      .from('missions')
      .select('mission_json')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();
      
    if (missionData && missionData.mission_json?.agents) {
      const agentIds = missionData.mission_json.agents.map((a: any) => a.id);
      if (agentIds.length > 0) {
        await supabase
          .from('events')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('event_type', 'agent.completed')
          .in('entity_id', agentIds);
      }
    }

    // ── Send to Inngest for background execution ──
    // Each agent runs as a separate Inngest step with its own timeout.
    // No more Vercel function timeouts!
    await inngest.send({
      name: 'mission.execute',
      data: { missionId, tenantId },
    });

    console.log(`[Execute] Mission ${missionId} sent to Inngest for background execution.`);

    return NextResponse.json({ 
      success: true, 
      message: 'Mission execution started in background',
      engine: 'inngest',
    });
  } catch (error) {
    console.error(`[POST /api/missions/${missionId}/execute] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to start execution', details: (error as Error).message },
      { status: 500 }
    );
  }
}
