import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { inngest } from '@/lib/inngest/client';

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    let mode: 'resume' | 'fresh' = 'fresh';
    try {
      const body = await request.json();
      if (body?.mode === 'resume') mode = 'resume';
    } catch { /* body is optional */ }

    const { createServiceClient } = await import('@/lib/supabase/server');
    const supabase = createServiceClient();

    // Fetch mission data once — used for permission check, cache clear, and run row creation
    const { data: missionData } = await supabase
      .from('missions')
      .select('mission_json')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();

    const missionJson = missionData?.mission_json as any;

    // ── Permission check ────────────────────────────────────────────────────
    const { verifyMissionPermissions } = await import('@/lib/services/oauth-refresher');
    const allMissing = await verifyMissionPermissions(missionId, tenantId);

    // Filter out providers that are no longer referenced in any agent's tools/connectors.
    // This prevents stale entries in mission.permissions (e.g. after removing Outlook
    // from the blueprint) from blocking runs and sending phantom connector emails.
    const agentText = missionJson
      ? JSON.stringify(missionJson.agents ?? []).toLowerCase()
      : '';

    const missingProviders = allMissing.filter(provider => {
      const aliases: Record<string, string[]> = {
        microsoft: ['microsoft', 'outlook', 'teams', 'onedrive', 'office'],
        google: ['google', 'gmail', 'sheets', 'drive', 'calendar', 'docs'],
        linkedin_oidc: ['linkedin'],
        atlassian: ['jira', 'confluence', 'atlassian'],
        monday: ['monday', 'mondaydotcom'],
      };
      const terms = [provider, ...(aliases[provider] ?? [])];
      return terms.some(t => agentText.includes(t));
    });

    if (missingProviders.length > 0) {
      try {
        const { data: { user } } = await supabase.auth.admin.getUserById(tenantId);
        const missionTitle = missionJson?.title || 'Unknown Mission';
        const customerEmail = user?.email || '';

        const oauthProviders = [
          'google', 'gmail', 'slack', 'github', 'notion', 'discord', 'zoho',
          'twitter', 'facebook', 'instagram', 'linkedin_oidc', 'linkedin',
          'hubspot', 'salesforce', 'airtable', 'asana', 'atlassian', 'jira',
          'monday', 'mondaydotcom', 'microsoft', 'outlook', 'dropbox',
          'intercom', 'mailchimp', 'paypal', 'shopify', 'linear', 'zendesk',
          'reddit', 'trello', 'youtube', 'whatsapp',
        ];
        const customerConnectable = missingProviders.filter(p => oauthProviders.includes(p));
        const platformOnly = missingProviders.filter(p => !oauthProviders.includes(p));

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
        }

        if (platformOnly.length > 0) {
          const { notifyAdminMissingConnectors } = await import('@/lib/services/email-notifications');
          await notifyAdminMissingConnectors(missionId, missionTitle, customerEmail || 'unknown', platformOnly);
        }
      } catch (emailErr) {
        console.error('[Execute] Failed to send notification:', emailErr);
      }

      return NextResponse.json(
        {
          error: 'missing_permission',
          providers: missingProviders,
          message: `This mission requires connectors that aren't configured yet: ${missingProviders.join(', ')}.`,
        },
        { status: 403 }
      );
    }

    // ── Generate runId here so the chat can subscribe before Inngest starts ──
    const runId = crypto.randomUUID();

    // ── Clear cache for fresh runs ──────────────────────────────────────────
    if (missionJson?.agents) {
      const agentIds = missionJson.agents.map((a: any) => a.id);
      if (agentIds.length > 0 && mode === 'fresh') {
        await supabase
          .from('events')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('event_type', 'agent.completed')
          .in('entity_id', agentIds);

        await supabase
          .from('proposed_actions')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('mission_id', missionId);
      }
    }

    // ── Pre-create mission_runs row so Realtime subscription can start immediately ──
    const { count: priorRuns } = await supabase
      .from('mission_runs')
      .select('*', { count: 'exact', head: true })
      .eq('mission_id', missionId);

    await supabase.from('mission_runs').insert({
      id: runId,
      tenant_id: tenantId,
      mission_id: missionId,
      run_number: (priorRuns ?? 0) + 1,
      trigger: 'manual',
      status: 'queued',
      agents_total: missionJson?.agents?.length ?? 0,
      agents_done: 0,
      agents_failed: 0,
    });

    // ── Send to Inngest ─────────────────────────────────────────────────────
    await inngest.send({
      name: 'mission.execute',
      data: { missionId, tenantId, mode, runId },
    });

    console.log(`[Execute] Mission ${missionId} sent to Inngest (mode=${mode}, runId=${runId}).`);

    return NextResponse.json({
      success: true,
      runId,
      agents: (missionJson?.agents ?? []).map((a: any) => ({ id: a.id, role: a.role })),
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
