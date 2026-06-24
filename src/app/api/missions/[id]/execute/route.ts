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
    // mode: "resume" skips clearing agent.completed events so execution picks up from last failed agent
    // mode: "fresh" (default) clears agent.completed events and restarts all agents from scratch
    let mode: 'resume' | 'fresh' = 'fresh';
    try {
      const body = await request.json();
      if (body?.mode === 'resume') mode = 'resume';
    } catch { /* body is optional */ }

    const { verifyMissionPermissions } = await import('@/lib/services/oauth-refresher');
    
    // Check if we have the required tokens
    const missingProviders = await verifyMissionPermissions(missionId, tenantId);
    
    if (missingProviders.length > 0) {
      // Determine: is this a customer-connectable issue or a platform-level issue?
      try {
        const { createServiceClient } = await import('@/lib/supabase/server');
        const supabase = createServiceClient();
        
        // Get mission title and customer email
        const { data: missionData } = await supabase
          .from('missions')
          .select('mission_json')
          .eq('id', missionId)
          .eq('tenant_id', tenantId)
          .single();
        
        const { data: { user } } = await supabase.auth.admin.getUserById(tenantId);
        const missionTitle = missionData?.mission_json?.title || 'Unknown Mission';
        const customerEmail = user?.email || '';
        
        // OAuth-connectable providers (customer can self-serve)
        const oauthProviders = ['google', 'linkedin_oidc', 'slack', 'github', 'notion', 'discord', 'zoho', 'twitter', 'facebook', 'instagram'];
        const customerConnectable = missingProviders.filter(p => oauthProviders.includes(p));
        const platformOnly = missingProviders.filter(p => !oauthProviders.includes(p));
        
        // Email the CUSTOMER for connectors they can connect themselves
        if (customerConnectable.length > 0 && customerEmail) {
          const { sendEmail, displayName } = await import('@/lib/services/email-notifications');
          const connectorListHtml = customerConnectable.map(p => `<li><strong>${displayName(p)}</strong></li>`).join('');
          await sendEmail({
            to: customerEmail,
            subject: `🔗 Connect Your Account — ${missionTitle}`,
            htmlBody: `
              <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #3b82f6;">🔗 Connect Your Account</h2>
                <p>Your mission <strong>"${missionTitle}"</strong> needs the following connectors to run:</p>
                <ul>${connectorListHtml}</ul>
                <p>Please go to your <strong>Connectors</strong> page and click <strong>"Connect →"</strong> to authorize your account.</p>
                <a href="https://agenticfactor.io/connectors" style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin-top: 16px;">Go to Connectors →</a>
                <p style="margin-top: 24px; color: #64748b;">After connecting, go back to your mission and click <strong>Force Restart</strong>.</p>
              </div>
            `,
          });
          console.log(`[Execute] Customer ${customerEmail} notified about connectable: ${customerConnectable.join(', ')}`);
        }
        
        // Email the ADMIN only for platform-level issues (non-OAuth connectors)
        if (platformOnly.length > 0) {
          const { notifyAdminMissingConnectors } = await import('@/lib/services/email-notifications');
          await notifyAdminMissingConnectors(missionId, missionTitle, customerEmail || 'unknown', platformOnly);
          console.log(`[Execute] Admin notified about platform connectors: ${platformOnly.join(', ')}`);
        }
      } catch (emailErr) {
        console.error('[Execute] Failed to send notification:', emailErr);
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
      if (agentIds.length > 0 && mode === 'fresh') {
        // Only clear completed-agent checkpoints on a fresh restart.
        // In "resume" mode the executor skips already-completed agents automatically.
        await supabase
          .from('events')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('event_type', 'agent.completed')
          .in('entity_id', agentIds);

        // Also clear any stale proposed_actions from the previous run — without
        // this, executeAgent() finds the old row before doing anything else and
        // short-circuits on it (re-pausing on 'pending', hard-failing on
        // 'rejected', or worst of all, re-running the real side effect again
        // on 'approved' — e.g. re-sending the same email). "Fresh start" must
        // mean no leftover decision carries over, not just no leftover output.
        await supabase
          .from('proposed_actions')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('mission_id', missionId);
      }
    }

    // ── Send to Inngest for background execution ──
    // Each agent runs as a separate Inngest step with its own timeout.
    // No more Vercel function timeouts!
    await inngest.send({
      name: 'mission.execute',
      data: { missionId, tenantId, mode },
    });

    console.log(`[Execute] Mission ${missionId} sent to Inngest (mode=${mode}).`);

    return NextResponse.json({
      success: true,
      message: mode === 'resume'
        ? 'Mission resuming from last completed agent'
        : 'Mission execution started fresh',
      engine: 'inngest',
      mode,
    });
  } catch (error) {
    console.error(`[POST /api/missions/${missionId}/execute] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to start execution', details: (error as Error).message },
      { status: 500 }
    );
  }
}
