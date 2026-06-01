import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// Email Notification Service
// Sends transactional emails via SMTP2GO API (or logs to events
// table as fallback if SMTP2GO_API_KEY is not configured).
// ============================================================

const SMTP2GO_API_KEY = process.env.SMTP2GO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'notifications@agenticfactor.io';
const FROM_NAME = process.env.FROM_NAME || 'Agentic Factor';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@agenticfactor.io';

interface EmailParams {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

/**
 * Send an email via SMTP2GO API, or log to events table as fallback.
 */
async function sendEmail(params: EmailParams): Promise<boolean> {
  const { to, subject, htmlBody, textBody } = params;

  if (SMTP2GO_API_KEY) {
    try {
      const res = await fetch('https://api.smtp2go.com/v3/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: SMTP2GO_API_KEY,
          to: [to],
          sender: `${FROM_NAME} <${FROM_EMAIL}>`,
          subject,
          html_body: htmlBody,
          text_body: textBody || htmlBody.replace(/<[^>]+>/g, ''),
        }),
      });
      const data = await res.json();
      if (data.data?.succeeded > 0) {
        console.log(`[Email] ✅ Sent to ${to}: "${subject}"`);
        return true;
      } else {
        console.error(`[Email] ❌ SMTP2GO failed:`, data);
      }
    } catch (err) {
      console.error(`[Email] ❌ SMTP2GO error:`, err);
    }
  }

  // Fallback: log to events table
  try {
    const supabase = createServiceClient();
    await supabase.from('events').insert({
      tenant_id: '00000000-0000-0000-0000-000000000000', // system event
      event_type: 'email.queued',
      entity_type: 'notification',
      entity_id: crypto.randomUUID(),
      payload: { to, subject, htmlBody: htmlBody.substring(0, 1000) },
    });
    console.log(`[Email] 📋 Logged to events (SMTP2GO not configured). To: ${to}, Subject: "${subject}"`);
  } catch (err) {
    console.error(`[Email] ❌ Failed to log email event:`, err);
  }
  return false;
}

// ============================================================
// Pre-built notification templates
// ============================================================

const DISPLAY_NAMES: Record<string, string> = {
  google: 'Google', linkedin_oidc: 'LinkedIn', slack: 'Slack',
  github: 'GitHub', notion: 'Notion', discord: 'Discord',
  zoho: 'Zoho', azure: 'Azure', twitter: 'X (Twitter)',
  facebook: 'Facebook', instagram: 'Instagram',
  whatsapp: 'WhatsApp', messenger: 'Messenger',
  teams: 'Microsoft Teams', stripe: 'Stripe',
};

function displayName(provider: string): string {
  return DISPLAY_NAMES[provider] || provider.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Notify admin that a mission requires connectors that aren't set up.
 */
export async function notifyAdminMissingConnectors(
  missionId: string,
  missionTitle: string,
  customerEmail: string,
  missingProviders: string[]
): Promise<void> {
  const providerList = missingProviders.map(p => `• ${displayName(p)}`).join('\n');
  const providerListHtml = missingProviders.map(p => `<li><strong>${displayName(p)}</strong></li>`).join('');

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `⚠️ Missing Connectors for Mission: ${missionTitle}`,
    htmlBody: `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #3b82f6;">⚠️ Connector Setup Required</h2>
        <p>A customer's mission requires connectors that are not yet configured.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px; font-weight: 600; color: #94a3b8;">Mission</td><td style="padding: 8px;">${missionTitle}</td></tr>
          <tr><td style="padding: 8px; font-weight: 600; color: #94a3b8;">Mission ID</td><td style="padding: 8px; font-family: monospace;">${missionId}</td></tr>
          <tr><td style="padding: 8px; font-weight: 600; color: #94a3b8;">Customer</td><td style="padding: 8px;">${customerEmail}</td></tr>
        </table>
        <h3 style="color: #f59e0b;">Missing Connectors:</h3>
        <ul>${providerListHtml}</ul>
        <p style="margin-top: 24px; color: #64748b;">Once you configure these connectors, the customer will be notified automatically.</p>
        <a href="https://agenticfactor.io/connectors" style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin-top: 16px;">Go to Connectors →</a>
      </div>
    `,
    textBody: `Missing Connectors for "${missionTitle}"\n\nCustomer: ${customerEmail}\nMission ID: ${missionId}\n\nMissing:\n${providerList}\n\nPlease configure at: https://agenticfactor.io/connectors`,
  });
}

/**
 * Notify customer that their connectors are now set up and ready.
 */
export async function notifyCustomerConnectorsReady(
  customerEmail: string,
  missionTitle: string,
  missionId: string,
  connectors: string[]
): Promise<void> {
  const connectorListHtml = connectors.map(p => `<li>✅ ${displayName(p)}</li>`).join('');

  await sendEmail({
    to: customerEmail,
    subject: `✅ Your Connectors Are Ready — ${missionTitle}`,
    htmlBody: `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #22c55e;">✅ Connectors Ready!</h2>
        <p>Great news! The connectors required for your mission have been configured.</p>
        <h3>Mission: ${missionTitle}</h3>
        <ul>${connectorListHtml}</ul>
        <p>You can now restart your mission to get the full results.</p>
        <a href="https://agenticfactor.io/dashboard/missions/${missionId}" style="display: inline-block; padding: 12px 24px; background: #22c55e; color: white; text-decoration: none; border-radius: 8px; margin-top: 16px;">Restart Mission →</a>
      </div>
    `,
  });
}

export { sendEmail, ADMIN_EMAIL, displayName };
