import { inngest } from './client';
import { createServiceClient } from '@/lib/supabase/server';

// ═══════════════════════════════════════════════════════════
// Inngest Function: Handle Inbound Email
//
// Triggered when an email arrives at a mission inbox
// (agents.agenticfactor.io → SendGrid → /api/email/inbound → Inngest).
//
// Re-fires mission.execute so the existing agent loop picks up
// the email.received event from the events table and processes it.
// ═══════════════════════════════════════════════════════════

export const handleInboundEmail = inngest.createFunction(
  {
    id: 'handle-inbound-email',
    name: 'Handle Inbound Email',
    retries: 2,
    triggers: [{ event: 'email.received' }],
  },
  async ({ event, step }) => {
    const { missionId, tenantId } = event.data as { missionId: string; tenantId: string };

    // Verify mission is still active before re-triggering
    const mission = await step.run('verify-mission-active', async () => {
      const supabase = createServiceClient();
      const { data } = await supabase
        .from('missions')
        .select('id, status')
        .eq('id', missionId)
        .eq('tenant_id', tenantId)
        .single();
      return data;
    });

    if (!mission || !['active', 'paused', 'completed', 'failed'].includes(mission.status)) {
      return { skipped: true, reason: 'mission_not_active', status: mission?.status };
    }

    // The email itself becomes the first agent's input (nothing reads email.received events
    // back out of the events table, so without this the agents never saw the email).
    const { emailData } = event.data as { emailData?: Record<string, unknown> };
    await step.sendEvent('trigger-mission-for-email', {
      name: 'mission.execute',
      data: { missionId, tenantId, trigger: 'email_received', webhookPayload: emailData ?? null },
    });

    return { triggered: true, missionId };
  }
);
