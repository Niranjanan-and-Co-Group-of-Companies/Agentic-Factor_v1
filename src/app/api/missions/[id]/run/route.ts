import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { inngest } from '@/lib/inngest/client';
import { buildTeam } from '@/lib/services/orchestrator';

// Longer timeout — buildTeam includes an LLM dry-run that can take 30–60s
export const maxDuration = 300;

// POST /api/missions/[id]/run
// First-run trigger for draft missions: provisions agents (buildTeam) then queues execution via Inngest.
// For re-runs and force-restarts, use /api/missions/[id]/execute instead.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    const { createServiceClient } = await import('@/lib/supabase/server');
    const supabase = createServiceClient();

    // Fetch mission — must belong to this tenant and be in draft status
    const { data: missionRow, error: fetchErr } = await supabase
      .from('missions')
      .select('mission_json, status')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchErr || !missionRow) {
      return NextResponse.json({ error: 'Mission not found.' }, { status: 404 });
    }

    if (missionRow.status !== 'draft') {
      return NextResponse.json(
        {
          error: 'already_started',
          message: `Mission is already in "${missionRow.status}" state. Use Force Restart to re-run it.`,
        },
        { status: 409 }
      );
    }

    // Verify OAuth tokens before spending time on provisioning
    const { verifyMissionPermissions } = await import('@/lib/services/oauth-refresher');
    const missingProviders = await verifyMissionPermissions(missionId, tenantId);

    if (missingProviders.length > 0) {
      const oauthProviders = ['google', 'linkedin_oidc', 'slack', 'github', 'notion', 'discord', 'zoho', 'twitter', 'facebook', 'instagram'];
      const connectable = missingProviders.filter(p => oauthProviders.includes(p));

      if (connectable.length > 0) {
        // Notify customer by email to self-serve
        try {
          const { data: { user } } = await supabase.auth.admin.getUserById(tenantId);
          const customerEmail = user?.email || '';
          if (customerEmail) {
            const { sendEmail, displayName } = await import('@/lib/services/email-notifications');
            const connectorListHtml = connectable.map(p => `<li><strong>${displayName(p)}</strong></li>`).join('');
            await sendEmail({
              to: customerEmail,
              subject: `🔗 Connect Your Account — ${missionRow.mission_json?.title || 'Your Mission'}`,
              htmlBody: `
                <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #3b82f6;">🔗 Connect Your Account</h2>
                  <p>Your mission <strong>"${missionRow.mission_json?.title || missionId}"</strong> needs the following connectors to run:</p>
                  <ul>${connectorListHtml}</ul>
                  <p>Please go to your <strong>Connectors</strong> page and click <strong>"Connect →"</strong> to authorize your account.</p>
                  <a href="https://agenticfactor.io/connectors" style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin-top: 16px;">Go to Connectors →</a>
                  <p style="margin-top: 24px; color: #64748b;">After connecting, go back to your mission and click <strong>Start Mission</strong>.</p>
                </div>
              `,
            });
          }
        } catch (emailErr) {
          console.error('[Run] Failed to send connector notification:', emailErr);
        }
      }

      return NextResponse.json(
        {
          error: 'missing_permission',
          providers: missingProviders,
          message: `This mission requires connectors that aren't configured yet: ${missingProviders.join(', ')}. Go to the Connectors page and connect them, then click Start Mission again.`,
        },
        { status: 403 }
      );
    }

    // Provision agents, wire the graph, run dry-run validation → transitions mission to 'active'
    console.log(`[Run] Building team for mission ${missionId}`);
    await buildTeam(missionRow.mission_json, tenantId);

    // Queue background execution via Inngest
    await inngest.send({
      name: 'mission.execute',
      data: { missionId, tenantId },
    });

    console.log(`[Run] Mission ${missionId} provisioned and queued for execution.`);

    return NextResponse.json({
      success: true,
      message: 'Mission provisioned and execution started in background.',
      engine: 'inngest',
    });
  } catch (error) {
    console.error(`[POST /api/missions/${missionId}/run] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to start mission', details: (error as Error).message },
      { status: 500 }
    );
  }
}
