import { ToolExecutionContext, registerTool } from './index';
import { routeOutreachEmail } from '../email-router';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';

async function sendEmailTool({ tenantId, args }: ToolExecutionContext) {
  const to = args.to as string;
  const subject = args.subject as string;
  const body = args.body as string;
  // Optional: agent or customer specifies "gmail" | "sendgrid" in prompt
  const provider = args.provider as string | undefined;
  // Optional: override the from address
  const from = args.from as string | undefined;

  if (!to || !subject || !body) {
    return { error: 'Missing required arguments: to, subject, body' };
  }

  const result = await routeOutreachEmail({ tenantId, to, subject, body, from, provider });
  if (result.success) {
    return { message: `Email sent to ${to} via ${result.provider}` };
  } else {
    return { error: `Failed to send email via ${result.provider}: ${result.error}` };
  }
}

async function readEmailTool({ args }: ToolExecutionContext) {
  const limit = (args.limit as number) || 5;
  const folder = (args.folder as string) || 'INBOX';
  const searchCriteria = (args.search as string[]) || ['UNSEEN'];

  const user = process.env.IMAP_USER;
  const password = process.env.IMAP_PASSWORD;
  const host = process.env.IMAP_HOST || 'imap.gmail.com';
  const port = parseInt(process.env.IMAP_PORT || '993', 10);

  if (!user || !password) {
    return { error: 'IMAP_USER or IMAP_PASSWORD is not configured in environment variables.' };
  }

  const config = {
    imap: {
      user,
      password,
      host,
      port,
      tls: true,
      authTimeout: 10000,
    },
  };

  try {
    const connection = await imaps.connect(config);
    await connection.openBox(folder);

    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''],
      markSeen: false,
    };

    const results = await connection.search(searchCriteria, fetchOptions);
    
    // Sort by most recent first
    results.reverse();
    const slicedResults = results.slice(0, limit);

    const emails = [];

    for (const res of slicedResults) {
      const all = res.parts.find((part) => part.which === '');
      if (all) {
        const id = res.attributes.uid;
        const parsed = await simpleParser(all.body);
        emails.push({
          id,
          subject: parsed.subject,
          from: parsed.from?.text,
          date: parsed.date,
          text: parsed.text, // plain text body
        });
      }
    }

    connection.end();
    return { emails };

  } catch (err) {
    console.error('[readEmailTool] IMAP Error:', err);
    return { error: `IMAP connection failed: ${(err as Error).message}` };
  }
}

// check_email_replies — searches INBOX for replies to a specific outreach email.
// Pass the original subject or the recipient email to find matching replies.
async function checkEmailReplies({ args }: ToolExecutionContext) {
  const originalSubject = args.original_subject as string | undefined;
  const from_email = args.from_email as string | undefined;
  const since_days = (args.since_days as number) || 7;
  const limit = (args.limit as number) || 20;

  const user = process.env.IMAP_USER;
  const password = process.env.IMAP_PASSWORD;
  const host = process.env.IMAP_HOST || 'imap.gmail.com';
  const port = parseInt(process.env.IMAP_PORT || '993', 10);

  if (!user || !password) {
    return { error: 'IMAP credentials not configured.' };
  }

  const config = { imap: { user, password, host, port, tls: true, authTimeout: 10000 } };

  try {
    const connection = await imaps.connect(config);
    await connection.openBox('INBOX');

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - since_days);
    const dateStr = sinceDate.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });

    const searchCriteria: unknown[] = [['SINCE', dateStr]];
    if (from_email) searchCriteria.push(['FROM', from_email]);

    const results = await connection.search(searchCriteria, { bodies: ['HEADER', 'TEXT', ''], markSeen: false });
    results.reverse();

    const emails = [];
    for (const res of results.slice(0, limit)) {
      const all = res.parts.find((part) => part.which === '');
      if (!all) continue;
      const parsed = await simpleParser(all.body);
      const subject = parsed.subject ?? '';
      // Check if this looks like a reply: subject starts with Re: or references our subject
      const isReply = subject.toLowerCase().startsWith('re:') ||
        (originalSubject && subject.toLowerCase().includes(originalSubject.toLowerCase().replace(/^re:\s*/i, '')));
      if (!isReply && originalSubject) continue;
      emails.push({
        id: res.attributes.uid,
        subject,
        from: parsed.from?.text,
        date: parsed.date,
        text: (parsed.text ?? '').slice(0, 1000),
        is_reply: true,
      });
    }
    connection.end();
    return { replies: emails, count: emails.length };
  } catch (err) {
    return { error: `IMAP error: ${(err as Error).message}` };
  }
}

// track_bounce — record a bounced email domain so agents don't retry
async function trackBounceTool({ tenantId, args }: ToolExecutionContext) {
  const { email, domain, reason } = args as { email?: string; domain?: string; reason?: string };
  const resolvedDomain = domain ?? email?.split('@')[1];
  if (!resolvedDomain) return { error: 'Provide email or domain' };

  const { createServiceClient } = await import('@/lib/supabase/server');
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('outreach_contacts')
    .upsert(
      { tenant_id: tenantId, domain: resolvedDomain.toLowerCase(), email: email ?? null, status: 'bounced', notes: reason ?? 'Bounced', last_sent_at: new Date().toISOString() },
      { onConflict: 'tenant_id,domain' }
    );
  if (error) return { error: `Failed to record bounce: ${error.message}` };
  return { success: true, domain: resolvedDomain, status: 'bounced' };
}

registerTool('send_email', sendEmailTool);
registerTool('read_email', readEmailTool);
registerTool('check_email_replies', checkEmailReplies);
registerTool('track_email_bounce', trackBounceTool);
