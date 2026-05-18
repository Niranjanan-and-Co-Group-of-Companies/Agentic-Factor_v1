import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { executeMission } from '@/lib/services/runtime/executor';
import { after } from 'next/server';

export const maxDuration = 300; // 5 minute max for Vercel Pro

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
      return NextResponse.json(
        { 
          error: 'missing_permission', 
          providers: missingProviders,
          message: `Missing permissions for: ${missingProviders.join(', ')}`
        }, 
        { status: 403 }
      );
    }

    // --- FIX: CLEAR CACHE FOR FRESH RUNS ---
    // If the user clicks "Start Mission", "Run Again", or "Force Restart", we must clear the old 
    // agent.completed events for this mission's agents so they actually run again instead of instantly returning cached data.
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
    // ----------------------------------------

    // Use Next.js `after()` to keep the function alive after sending the response.
    // This is the production-ready way to run background work on Vercel.
    // The mission execution continues even after the HTTP response is sent.
    after(async () => {
      try {
        await executeMission(missionId, tenantId);
      } catch (err) {
        console.error(`[Background Execution Error] Mission ${missionId}:`, err);
      }
    });

    return NextResponse.json({ success: true, message: 'Execution started' });
  } catch (error) {
    console.error(`[POST /api/missions/${missionId}/execute] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to start execution', details: (error as Error).message },
      { status: 500 }
    );
  }
}
