import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

// track_outreach_contact
// Atomic check-and-record: returns already_contacted=true if this
// tenant has emailed this domain before; otherwise inserts the row
// and returns already_contacted=false. A single call covers both
// the deduplication guard and the audit record — no double-send
// even if the mission runs concurrently.
async function trackOutreachContact({ tenantId, args }: ToolExecutionContext) {
  const domain       = (args.domain        as string | undefined)?.toLowerCase().trim();
  const company_name = args.company_name   as string | undefined;
  const email        = args.email          as string | undefined;
  const status       = (args.status        as string | undefined) ?? 'sent';
  const notes        = args.notes          as string | undefined;

  if (!domain) return { error: 'Missing required argument: domain' };

  const supabase = createServiceClient();

  // Upsert: conflict on (tenant_id, domain) → update last_sent_at and status
  const { data, error } = await supabase
    .from('outreach_contacts')
    .upsert(
      {
        tenant_id:    tenantId,
        domain,
        company_name: company_name ?? null,
        email:        email        ?? null,
        status,
        notes:        notes        ?? null,
        last_sent_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,domain', ignoreDuplicates: false }
    )
    .select('first_sent_at, last_sent_at, status')
    .single();

  if (error) return { error: `Failed to record outreach contact: ${error.message}` };

  // If first_sent_at !== last_sent_at this was a pre-existing row
  const alreadyContacted =
    data.first_sent_at !== data.last_sent_at || data.status === 'unsubscribed';

  return {
    already_contacted: alreadyContacted,
    domain,
    status:      data.status,
    first_sent:  data.first_sent_at,
    last_sent:   data.last_sent_at,
  };
}

// query_outreach_contacts
// Returns all domains this tenant has already contacted.
// Useful at the start of a prospecting run to build an exclusion list.
async function queryOutreachContacts({ tenantId, args }: ToolExecutionContext) {
  const status_filter = args.status as string | undefined;

  const supabase = createServiceClient();

  let q = supabase
    .from('outreach_contacts')
    .select('domain, company_name, email, status, first_sent_at, last_sent_at')
    .eq('tenant_id', tenantId)
    .order('last_sent_at', { ascending: false });

  if (status_filter) q = q.eq('status', status_filter);

  const { data, error } = await q;
  if (error) return { error: `Failed to query outreach contacts: ${error.message}` };

  return { contacts: data ?? [], total: (data ?? []).length };
}

// update_outreach_status
// Lets the reply-checker agent mark a contact as replied/bounced/unsubscribed.
async function updateOutreachStatus({ tenantId, args }: ToolExecutionContext) {
  const domain = (args.domain as string | undefined)?.toLowerCase().trim();
  const status = args.status as string | undefined;
  const notes  = args.notes  as string | undefined;

  if (!domain) return { error: 'Missing required argument: domain' };
  if (!status) return { error: 'Missing required argument: status' };

  const valid = ['sent', 'replied', 'bounced', 'unsubscribed'];
  if (!valid.includes(status)) {
    return { error: `Invalid status "${status}". Must be one of: ${valid.join(', ')}` };
  }

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('outreach_contacts')
    .update({ status, notes: notes ?? null })
    .eq('tenant_id', tenantId)
    .eq('domain', domain);

  if (error) return { error: `Failed to update outreach status: ${error.message}` };

  return { success: true, domain, status };
}

// schedule_followup — schedules a follow-up email to be sent after N days if status is still 'sent'.
// Stores a follow-up record in outreach_contacts notes field with due date.
// A follow-up mission should call query_outreach_contacts with status='sent' and check follow_up_due.
async function scheduleFollowupTool({ tenantId, args }: ToolExecutionContext) {
  const domain = (args.domain as string | undefined)?.toLowerCase().trim();
  const delay_days = (args.delay_days as number) || 3;
  const followup_subject = args.followup_subject as string | undefined;
  const followup_body = args.followup_body as string | undefined;

  if (!domain) return { error: 'Missing required argument: domain' };

  const supabase = createServiceClient();
  const due = new Date();
  due.setDate(due.getDate() + delay_days);

  const followupNote = JSON.stringify({ followup_due: due.toISOString(), followup_subject, followup_body });

  const { error } = await supabase
    .from('outreach_contacts')
    .update({ notes: followupNote })
    .eq('tenant_id', tenantId)
    .eq('domain', domain)
    .eq('status', 'sent');

  if (error) return { error: `Failed to schedule follow-up: ${error.message}` };
  return { success: true, domain, follow_up_due: due.toISOString(), delay_days };
}

// classify_reply — uses simple keyword heuristics to classify an inbound reply.
// Returns: interested | not_interested | out_of_office | wrong_person | question | unsubscribe
async function classifyReplyTool({ args }: ToolExecutionContext) {
  const text = ((args.text as string) ?? '').toLowerCase();
  const subject = ((args.subject as string) ?? '').toLowerCase();
  const combined = `${subject} ${text}`;

  if (/unsubscribe|opt.?out|stop email|remove me|don't (contact|email)|do not (contact|email)/i.test(combined)) {
    return { classification: 'unsubscribe', confidence: 'high', action: 'Mark as unsubscribed immediately and never contact again.' };
  }
  if (/out of office|on vacation|on leave|will be back|holiday|away from|auto.?reply/i.test(combined)) {
    return { classification: 'out_of_office', confidence: 'high', action: 'Wait until they return and follow up then.' };
  }
  if (/not the right person|wrong person|you want|you should contact|please reach out to|forward/i.test(combined)) {
    return { classification: 'wrong_person', confidence: 'medium', action: 'Find the correct contact for this company.' };
  }
  if (/not interested|no thank|no thanks|not a fit|not relevant|pass on this|not looking|don't need/i.test(combined)) {
    return { classification: 'not_interested', confidence: 'high', action: 'Mark as not_interested and stop outreach.' };
  }
  if (/interested|tell me more|sounds (good|great|interesting)|let's (talk|chat|connect|schedule|discuss)|book|call|meeting|demo|yes please|happy to/i.test(combined)) {
    return { classification: 'interested', confidence: 'high', action: 'Reply promptly and schedule a call or send Calendly link.' };
  }
  if (/\?|how much|pricing|cost|what is|can you|do you|is this|when|where|which/i.test(combined)) {
    return { classification: 'question', confidence: 'medium', action: 'Answer their question thoughtfully and move toward a call.' };
  }
  return { classification: 'unknown', confidence: 'low', action: 'Read manually and classify.' };
}

// get_followup_due — returns all contacts with a follow-up due today or earlier
async function getFollowupDueTool({ tenantId }: ToolExecutionContext) {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('outreach_contacts')
    .select('domain, company_name, email, notes, first_sent_at, last_sent_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'sent');

  if (error) return { error: `Failed to query follow-ups: ${error.message}` };

  const due = (data ?? []).filter(c => {
    try {
      const parsed = JSON.parse(c.notes ?? '{}');
      return parsed.followup_due && parsed.followup_due <= now;
    } catch { return false; }
  }).map(c => {
    const parsed = JSON.parse(c.notes ?? '{}');
    return { ...c, followup_due: parsed.followup_due, followup_subject: parsed.followup_subject, followup_body: parsed.followup_body };
  });

  return { followups_due: due, count: due.length };
}

registerTool('track_outreach_contact',  trackOutreachContact);
registerTool('query_outreach_contacts', queryOutreachContacts);
registerTool('update_outreach_status',  updateOutreachStatus);
registerTool('schedule_followup',        scheduleFollowupTool);
registerTool('classify_reply',           classifyReplyTool);
registerTool('get_followups_due',        getFollowupDueTool);
