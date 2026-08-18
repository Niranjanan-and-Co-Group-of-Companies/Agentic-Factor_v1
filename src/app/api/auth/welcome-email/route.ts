import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/services/notifications';

export async function POST(req: NextRequest) {
  try {
    const { email, name } = await req.json() as { email?: string; name?: string };
    if (!email) return NextResponse.json({ ok: false, error: 'Missing email' }, { status: 400 });

    const displayName = name || email.split('@')[0];

    const htmlBody = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#3B82F6,#8B5CF6);padding:32px 24px;border-radius:16px;text-align:center;margin-bottom:32px;">
          <div style="font-size:36px;margin-bottom:8px;">⚡</div>
          <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">Welcome to Agentic Factor</h1>
          <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">AI agents that run your business, hands-free</p>
        </div>

        <!-- Greeting -->
        <p style="font-size:16px;color:#1e293b;margin-bottom:24px;">Hi ${displayName},</p>
        <p style="font-size:15px;color:#334155;line-height:1.7;margin-bottom:28px;">
          You're now on Agentic Factor — a platform where AI agents handle entire workflows for you,
          from research to outreach to reporting, completely hands-free.
        </p>

        <!-- 5-minute guide -->
        <div style="background:#f8fafc;border-radius:12px;padding:24px;margin-bottom:28px;">
          <h2 style="font-size:15px;font-weight:700;color:#1e293b;margin:0 0 16px;">Run your first mission in 5 minutes</h2>

          <div style="display:flex;gap:14px;margin-bottom:14px;align-items:flex-start;">
            <div style="width:28px;height:28px;border-radius:50%;background:#3B82F6;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;text-align:center;line-height:28px;">1</div>
            <div>
              <div style="font-size:14px;font-weight:600;color:#1e293b;">Open Command Center</div>
              <div style="font-size:13px;color:#64748b;margin-top:2px;">Your AI Chief of Staff dashboard — ask it anything.</div>
            </div>
          </div>

          <div style="display:flex;gap:14px;margin-bottom:14px;align-items:flex-start;">
            <div style="width:28px;height:28px;border-radius:50%;background:#8B5CF6;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;text-align:center;line-height:28px;">2</div>
            <div>
              <div style="font-size:14px;font-weight:600;color:#1e293b;">Create a Mission</div>
              <div style="font-size:13px;color:#64748b;margin-top:2px;">Click "+ New Mission" and describe what to automate in plain English.</div>
            </div>
          </div>

          <div style="display:flex;gap:14px;margin-bottom:14px;align-items:flex-start;">
            <div style="width:28px;height:28px;border-radius:50%;background:#06b6d4;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;text-align:center;line-height:28px;">3</div>
            <div>
              <div style="font-size:14px;font-weight:600;color:#1e293b;">Connect Your Tools</div>
              <div style="font-size:13px;color:#64748b;margin-top:2px;">Link Google, Slack, HubSpot, YouTube, and more under Connectors.</div>
            </div>
          </div>

          <div style="display:flex;gap:14px;align-items:flex-start;">
            <div style="width:28px;height:28px;border-radius:50%;background:#22c55e;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;text-align:center;line-height:28px;">4</div>
            <div>
              <div style="font-size:14px;font-weight:600;color:#1e293b;">Hit Run Now</div>
              <div style="font-size:13px;color:#64748b;margin-top:2px;">Watch each agent work in real-time. Schedule it to run forever.</div>
            </div>
          </div>
        </div>

        <!-- CTA -->
        <div style="text-align:center;margin-bottom:32px;">
          <a href="https://agenticfactor.io/dashboard" style="display:inline-block;background:linear-gradient(135deg,#3B82F6,#8B5CF6);color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;">
            Open Command Center →
          </a>
        </div>

        <p style="font-size:13px;color:#94a3b8;text-align:center;line-height:1.6;">
          You get free credits to start — no card needed.<br/>
          Questions? Just ask in the Command Center chat or reply to this email.
        </p>

        <!-- Footer -->
        <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8;">
          Agentic Factor · <a href="https://agenticfactor.io" style="color:#94a3b8;">agenticfactor.io</a>
        </div>
      </div>
    `;

    const body = [
      `Hi ${displayName},`,
      ``,
      `Welcome to Agentic Factor — AI agents that run your business, hands-free.`,
      ``,
      `Run your first mission in 5 minutes:`,
      `1. Open Command Center: https://agenticfactor.io/dashboard`,
      `2. Click "+ New Mission" and describe what to automate in plain English`,
      `3. Connect your tools under Connectors (Google, Slack, HubSpot, YouTube, and more)`,
      `4. Hit "Run Now" and watch your agents work in real-time`,
      ``,
      `You get free credits to start — no card needed.`,
      ``,
      `Questions? Just ask in the Command Center chat — it knows your account.`,
      ``,
      `Welcome aboard,`,
      `The Agentic Factor Team`,
      `https://agenticfactor.io`,
    ].join('\n');

    await sendEmail({
      to: email,
      subject: `Welcome to Agentic Factor — run your first mission in 5 minutes`,
      body,
      htmlBody,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[welcome-email]', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
