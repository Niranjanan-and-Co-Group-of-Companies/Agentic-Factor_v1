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

registerTool('send_email', sendEmailTool);
registerTool('read_email', readEmailTool);
