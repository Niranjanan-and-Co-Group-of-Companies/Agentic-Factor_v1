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

registerTool('track_outreach_contact',  trackOutreachContact);
registerTool('query_outreach_contacts', queryOutreachContacts);
registerTool('update_outreach_status',  updateOutreachStatus);
