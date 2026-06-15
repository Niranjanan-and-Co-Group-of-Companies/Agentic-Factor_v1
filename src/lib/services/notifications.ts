import nodemailer from 'nodemailer';

interface EmailOptions {
  to: string;
  subject: string;
  body: string;
  from?: string;
  fromName?: string;
  htmlBody?: string;
  attachments?: { filename: string; content: string; type: string }[];
}

/**
 * Send an outreach/agent email via Zoho Mail SMTP.
 * Used when a mission needs to send emails to external companies/contacts.
 * Falls back to sendEmail (SMTP2GO) if Zoho SMTP is not configured.
 */
export async function sendOutreachEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  const zohoUser = process.env.ZOHO_SMTP_USER;
  const zohoPass = process.env.ZOHO_SMTP_PASS;

  if (!zohoUser || !zohoPass) {
    return sendEmail(options);
  }

  const fromName = options.fromName || process.env.OUTREACH_FROM_NAME || 'Agentic Factor';
  const fromAddress = options.from || zohoUser;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.ZOHO_SMTP_HOST || 'smtp.zoho.in',
      port: parseInt(process.env.ZOHO_SMTP_PORT || '587', 10),
      secure: false,
      auth: { user: zohoUser, pass: zohoPass },
    });

    const htmlContent = options.htmlBody || `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333; line-height: 1.6;">
        ${options.body.split('\n').map(line => `<p style="margin: 10px 0;">${line}</p>`).join('')}
      </div>
    `;

    await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: options.to,
      subject: options.subject,
      text: options.body,
      html: htmlContent,
    });

    console.log(`[outreach] ✅ Sent via Zoho SMTP to ${options.to}`);
    return { success: true };
  } catch (err) {
    console.error('[outreach] Zoho SMTP failed, falling back to SMTP2GO:', (err as Error).message);
    return sendEmail(options);
  }
}

/**
 * Send a system/notification email via SMTP2GO API.
 * Falls back to console.log if SMTP2GO_API_KEY is not set.
 */
export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.SMTP2GO_API_KEY;
  const sender = options.from || process.env.SMTP2GO_SENDER || 'noreply@agenticfactor.io';

  // If no SMTP2GO key, log and succeed silently
  if (!apiKey) {
    console.log('[notifications] SMTP2GO not configured. Email would be sent to:', options.to);
    console.log('[notifications] Subject:', options.subject);
    console.log('[notifications] Body:', options.body);
    return { success: true };
  }

  try {
    const htmlContent = options.htmlBody || `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="background: linear-gradient(135deg, #3B82F6, #8B5CF6); padding: 24px; border-radius: 12px; color: white; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 20px;">⚡ Agentic Factor</h1>
        </div>
        <div style="padding: 16px 0;">
          ${options.body.split('\n').map(line => `<p style="margin: 8px 0; color: #333; line-height: 1.6;">${line}</p>`).join('')}
        </div>
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #999;">
          Sent by Agentic Factor Notifications
        </div>
      </div>
    `;

    const emailPayload: any = {
      sender,
      to: [options.to],
      subject: options.subject,
      text_body: options.body,
      html_body: htmlContent,
    };

    // Add attachments if provided
    if (options.attachments && options.attachments.length > 0) {
      emailPayload.attachments = options.attachments.map(att => ({
        filename: att.filename,
        fileblob: att.content,  // base64 encoded content
        mimetype: att.type,
      }));
    }

    const res = await fetch('https://api.smtp2go.com/v3/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Smtp2go-Api-Key': apiKey },
      body: JSON.stringify(emailPayload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[notifications] SMTP2GO error:', err);
      return { success: false, error: err };
    }

    return { success: true };
  } catch (err) {
    console.error('[notifications] Send failed:', (err as Error).message);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Send a connector request notification to admin.
 */
export async function notifyConnectorRequest(
  connectorId: string,
  connectorLabel: string,
  userId: string,
  userEmail: string | null
): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP2GO_SENDER || 'admin@agentfactory.dev';

  await sendEmail({
    to: adminEmail,
    subject: `🔌 Connector Request: ${connectorLabel}`,
    body: [
      `New connector request from Agentic Factor:`,
      ``,
      `Connector: ${connectorLabel} (${connectorId})`,
      `User ID: ${userId}`,
      `User Email: ${userEmail || 'Not provided'}`,
      `Timestamp: ${new Date().toISOString()}`,
      ``,
      `Please prioritize this integration.`,
    ].join('\n'),
  });
}

/**
 * Notify tenant about mission status changes.
 * Looks up the user's email from Supabase auth.
 */
export async function notifyMissionStatus(
  tenantId: string,
  missionTitle: string,
  missionId: string,
  status: 'completed' | 'failed' | 'paused' | 'needs_approval' | 'awaiting_input'
): Promise<void> {
  // Lazy import to avoid circular dependency
  const { createServiceClient } = await import('@/lib/supabase/server');
  const supabase = createServiceClient();

  // Get user email from auth
  const { data: { user } } = await supabase.auth.admin.getUserById(tenantId);
  const email = user?.email;
  if (!email) {
    console.log(`[notifications] No email found for tenant ${tenantId}, skipping notification.`);
    return;
  }

  const dashboardUrl = `https://agenticfactor.io/dashboard/missions/${missionId}`;

  const templates: Record<string, { subject: string; body: string }> = {
    completed: {
      subject: `✅ Mission Complete: ${missionTitle}`,
      body: [
        `Your mission "${missionTitle}" has been completed successfully!`,
        ``,
        `All agents in the pipeline finished their tasks and produced output.`,
        ``,
        `View results: ${dashboardUrl}`,
        ``,
        `You can rate this mission's performance to help the AI learn and improve.`,
      ].join('\n'),
    },
    failed: {
      subject: `❌ Mission Failed: ${missionTitle}`,
      body: [
        `Your mission "${missionTitle}" has failed.`,
        ``,
        `An agent in the pipeline encountered an error after multiple retry attempts.`,
        ``,
        `View details and retry: ${dashboardUrl}`,
        ``,
        `You can edit the blueprint and try again, or contact support.`,
      ].join('\n'),
    },
    paused: {
      subject: `⏸ Mission Paused: ${missionTitle}`,
      body: [
        `Your mission "${missionTitle}" has been paused.`,
        ``,
        `This may be due to a scheduled wait, rate limit, or manual pause.`,
        ``,
        `Resume from dashboard: ${dashboardUrl}`,
      ].join('\n'),
    },
    needs_approval: {
      subject: `🔔 Action Required: ${missionTitle}`,
      body: [
        `Your mission "${missionTitle}" needs your attention!`,
        ``,
        `An agent has completed its work and is waiting for your approval before the output is handed off to the next agent.`,
        ``,
        `Review and approve: ${dashboardUrl}`,
      ].join('\n'),
    },
    awaiting_input: {
      subject: `💬 Your Input Needed: ${missionTitle}`,
      body: [
        `Your mission "${missionTitle}" has paused and needs your input to continue.`,
        ``,
        `One of your agents has a question that requires your answer before the mission can proceed.`,
        ``,
        `Answer now: ${dashboardUrl}`,
        ``,
        `You can respond directly on the mission page or via the Chief of Staff chat.`,
      ].join('\n'),
    },
  };

  const template = templates[status];
  if (!template) return;

  await sendEmail({ to: email, ...template });
}

/**
 * Send a mission output/results email to the customer.
 * Used when a mission completes with deliverables (PDFs, spreadsheets, reports).
 */
export async function sendMissionOutputEmail(
  tenantId: string,
  missionTitle: string,
  missionId: string,
  outputSummary: string,
  artifactUrls?: { filename: string; url: string }[],
): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server');
  const supabase = createServiceClient();
  const { data: { user } } = await supabase.auth.admin.getUserById(tenantId);
  const email = user?.email;
  if (!email) return;

  const dashboardUrl = `https://agenticfactor.io/dashboard/missions/${missionId}`;
  
  const artifactsList = artifactUrls?.length
    ? artifactUrls.map(a => `📎 ${a.filename}: ${a.url}`).join('\n')
    : 'View all deliverables on your dashboard.';

  await sendEmail({
    to: email,
    subject: `📦 Mission Deliverables Ready: ${missionTitle}`,
    body: [
      `Your mission "${missionTitle}" has produced results!`,
      ``,
      `Summary:`,
      outputSummary,
      ``,
      `Deliverables:`,
      artifactsList,
      ``,
      `View full results: ${dashboardUrl}`,
    ].join('\n'),
  });
}

