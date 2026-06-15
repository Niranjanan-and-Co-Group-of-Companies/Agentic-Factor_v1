// ============================================================
// Customer Email Router
//
// Routes agent send_email calls through the customer's own
// connected email provider, with explicit provider choice or
// automatic priority fallback.
//
// Priority (auto): Gmail → SendGrid → SMTP2GO (platform)
//
// Provider selection: agent can pass provider="gmail" or
// provider="sendgrid" in tool args to force a specific one.
// ============================================================

import { getValidTokens } from './oauth-refresher';
import { sendEmail } from './notifications';
import { createServiceClient } from '../supabase/server';

export interface OutreachEmailOptions {
  tenantId: string;
  to: string;
  subject: string;
  body: string;
  from?: string;       // override from address (optional)
  provider?: string;   // "gmail" | "sendgrid" — omit for auto priority
}

export interface EmailRouterResult {
  success: boolean;
  provider: string;    // which provider was actually used
  error?: string;
}

// ── Gmail via OAuth ──────────────────────────────────────────

async function sendViaGmail(
  tenantId: string,
  to: string,
  subject: string,
  body: string,
  fromOverride?: string
): Promise<EmailRouterResult> {
  const token = await getValidTokens(tenantId, 'google');
  if (!token) return { success: false, provider: 'gmail', error: 'Google not connected' };

  try {
    // Get the customer's Gmail address
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!profileRes.ok) return { success: false, provider: 'gmail', error: 'Failed to fetch Gmail profile' };
    const profile = await profileRes.json();
    const fromAddress = fromOverride || profile.emailAddress;

    // Build RFC 2822 message and base64url encode it
    const rawMessage = [
      `From: ${fromAddress}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      body,
    ].join('\r\n');

    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      return { success: false, provider: 'gmail', error: err };
    }

    console.log(`[email-router] ✅ Sent via Gmail (${fromAddress}) to ${to}`);
    return { success: true, provider: 'gmail' };
  } catch (err) {
    return { success: false, provider: 'gmail', error: (err as Error).message };
  }
}

// ── SendGrid via API key ─────────────────────────────────────

async function sendViaSendGrid(
  tenantId: string,
  to: string,
  subject: string,
  body: string,
  fromOverride?: string
): Promise<EmailRouterResult> {
  // SendGrid API key is stored as access_token in tenant_permissions
  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'sendgrid')
    .single();

  if (!row?.access_token) return { success: false, provider: 'sendgrid', error: 'SendGrid not connected' };

  const fromAddress = fromOverride || process.env.SMTP2GO_SENDER || 'noreply@agenticfactor.io';

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${row.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromAddress },
        subject,
        content: [{ type: 'text/plain', value: body }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, provider: 'sendgrid', error: err };
    }

    console.log(`[email-router] ✅ Sent via SendGrid to ${to}`);
    return { success: true, provider: 'sendgrid' };
  } catch (err) {
    return { success: false, provider: 'sendgrid', error: (err as Error).message };
  }
}

// ── Main router ──────────────────────────────────────────────

export async function routeOutreachEmail(opts: OutreachEmailOptions): Promise<EmailRouterResult> {
  const { tenantId, to, subject, body, from, provider } = opts;

  // Explicit provider requested by agent or customer
  if (provider) {
    const p = provider.toLowerCase();
    if (p === 'gmail' || p === 'google') {
      const result = await sendViaGmail(tenantId, to, subject, body, from);
      if (result.success) return result;
      console.warn(`[email-router] Gmail failed: ${result.error}. Falling back to SMTP2GO.`);
    } else if (p === 'sendgrid') {
      const result = await sendViaSendGrid(tenantId, to, subject, body, from);
      if (result.success) return result;
      console.warn(`[email-router] SendGrid failed: ${result.error}. Falling back to SMTP2GO.`);
    }
    // Unknown provider or explicit one failed → fall through to SMTP2GO
  } else {
    // Auto priority: Gmail → SendGrid → SMTP2GO
    const gmail = await sendViaGmail(tenantId, to, subject, body, from);
    if (gmail.success) return gmail;

    const sg = await sendViaSendGrid(tenantId, to, subject, body, from);
    if (sg.success) return sg;

    console.log('[email-router] No customer provider available. Using platform SMTP2GO.');
  }

  // Platform SMTP2GO fallback
  const result = await sendEmail({ to, subject, body, from });
  return { success: result.success, provider: 'smtp2go', error: result.error };
}
