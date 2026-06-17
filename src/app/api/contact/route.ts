import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/services/email-notifications';

// ============================================================
// POST /api/contact — Public contact form handler
//
// Sends two emails on a valid submission:
//   1. Notification to hello@agenticfactor.io with full form details
//   2. Auto-reply to the submitter confirming receipt
//
// No auth required — this is the public contact page.
// ============================================================

export const maxDuration = 30;

const CONTACT_INBOX = 'hello@agenticfactor.io';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, subject, message } = body as {
      name?: string;
      email?: string;
      subject?: string;
      message?: string;
    };

    // ── Validation ──
    if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
      return NextResponse.json(
        { error: 'All fields are required.' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { error: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }

    if (message.trim().length < 10) {
      return NextResponse.json(
        { error: 'Message is too short.' },
        { status: 400 }
      );
    }

    const safeName    = name.trim().substring(0, 120);
    const safeEmail   = email.trim().toLowerCase().substring(0, 254);
    const safeSubject = subject.trim().substring(0, 200);
    const safeMessage = message.trim().substring(0, 5000);

    // ── 1. Notify admin ──
    await sendEmail({
      to: CONTACT_INBOX,
      subject: `📬 Contact Form: ${safeSubject}`,
      htmlBody: `
        <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
          <div style="background: #3b82f6; padding: 24px 32px; border-radius: 12px 12px 0 0;">
            <h2 style="color: white; margin: 0; font-size: 1.2rem;">📬 New Contact Form Submission</h2>
          </div>
          <div style="background: #f8fafc; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
              <tr>
                <td style="padding: 10px 0; font-weight: 600; color: #64748b; width: 90px; vertical-align: top;">From</td>
                <td style="padding: 10px 0; color: #1e293b;">${safeName} &lt;<a href="mailto:${safeEmail}" style="color: #3b82f6;">${safeEmail}</a>&gt;</td>
              </tr>
              <tr style="border-top: 1px solid #e2e8f0;">
                <td style="padding: 10px 0; font-weight: 600; color: #64748b; vertical-align: top;">Subject</td>
                <td style="padding: 10px 0; color: #1e293b;">${safeSubject}</td>
              </tr>
              <tr style="border-top: 1px solid #e2e8f0;">
                <td style="padding: 10px 0; font-weight: 600; color: #64748b; vertical-align: top;">Message</td>
                <td style="padding: 10px 0; color: #1e293b; white-space: pre-wrap; line-height: 1.6;">${safeMessage}</td>
              </tr>
            </table>
            <a href="mailto:${safeEmail}?subject=Re: ${encodeURIComponent(safeSubject)}"
               style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
              Reply to ${safeName} →
            </a>
            <p style="margin-top: 20px; font-size: 0.78rem; color: #94a3b8;">
              Submitted via agenticfactor.io/contact
            </p>
          </div>
        </div>
      `,
      textBody: `New contact form submission\n\nFrom: ${safeName} <${safeEmail}>\nSubject: ${safeSubject}\n\nMessage:\n${safeMessage}`,
    });

    // ── 2. Auto-reply to submitter ──
    await sendEmail({
      to: safeEmail,
      subject: `We received your message — Agentic Factor`,
      htmlBody: `
        <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
          <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px 32px; border-radius: 12px 12px 0 0;">
            <h2 style="color: white; margin: 0; font-size: 1.2rem;">✅ Message Received</h2>
          </div>
          <div style="background: #f8fafc; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="font-size: 1rem; margin: 0 0 16px;">Hi <strong>${safeName}</strong>,</p>
            <p style="line-height: 1.7; color: #475569;">
              Thanks for reaching out! We have received your message and will get back to you within <strong>24 hours</strong> on business days.
            </p>
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
              <p style="margin: 0 0 8px; font-size: 0.78rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Your message</p>
              <p style="margin: 0; font-weight: 600; color: #1e293b;">${safeSubject}</p>
              <p style="margin: 8px 0 0; color: #64748b; font-size: 0.88rem; white-space: pre-wrap; line-height: 1.6;">${safeMessage.substring(0, 300)}${safeMessage.length > 300 ? '…' : ''}</p>
            </div>
            <p style="line-height: 1.7; color: #475569;">
              If your inquiry is urgent, you can also email us directly at
              <a href="mailto:hello@agenticfactor.io" style="color: #6366f1;">hello@agenticfactor.io</a>.
            </p>
            <p style="margin-top: 24px; color: #475569;">— The Agentic Factor Team</p>
          </div>
          <p style="text-align: center; font-size: 0.75rem; color: #94a3b8; margin-top: 16px;">
            Agentic Factor · Thrissur, Kerala, India
          </p>
        </div>
      `,
      textBody: `Hi ${safeName},\n\nThanks for reaching out! We received your message and will reply within 24 hours on business days.\n\nYour message:\n"${safeSubject}"\n\nIf urgent, email us at hello@agenticfactor.io.\n\n— The Agentic Factor Team`,
    });

    console.log(`[Contact] Form submitted by ${safeName} <${safeEmail}> — "${safeSubject}"`);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('[Contact] Error:', err);
    return NextResponse.json(
      { error: 'Failed to send message. Please email us directly at hello@agenticfactor.io.' },
      { status: 500 }
    );
  }
}
