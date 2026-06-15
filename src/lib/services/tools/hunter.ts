import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

async function findEmailTool({ tenantId, args }: ToolExecutionContext) {
  const domain = args.domain as string | undefined;
  const firstName = args.first_name as string | undefined;
  const lastName = args.last_name as string | undefined;
  const company = args.company as string | undefined;

  if (!domain) {
    return { error: 'Missing required argument: domain' };
  }

  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'hunter')
    .single();

  if (!row?.access_token) {
    return {
      error: 'Hunter.io API key not connected. Please add your Hunter.io API key in the Connectors page.',
      connector_required: true,
      provider: 'hunter',
    };
  }

  const apiKey = row.access_token;

  try {
    // Email Finder: best when we have a first or last name
    if (firstName || lastName) {
      const params = new URLSearchParams({ api_key: apiKey, domain });
      if (firstName) params.set('first_name', firstName);
      if (lastName) params.set('last_name', lastName);
      if (company) params.set('company', company);

      const res = await fetch(`https://api.hunter.io/v2/email-finder?${params}`);
      const data = await res.json();

      if (!res.ok) {
        const detail = data.errors?.[0]?.details || data.errors?.[0]?.id || `HTTP ${res.status}`;
        return { error: `Hunter.io error: ${detail}` };
      }

      const { email, score, sources } = data.data ?? {};
      if (!email) {
        return { found: false, message: `No email found for ${firstName ?? ''} ${lastName ?? ''} at ${domain}` };
      }

      return {
        found: true,
        email,
        confidence: score,
        sources: (sources ?? []).slice(0, 3).map((s: any) => s.uri),
        domain,
      };
    }

    // Domain Search: returns up to 5 emails for a domain
    const params = new URLSearchParams({ api_key: apiKey, domain, limit: '5' });
    if (company) params.set('company', company);

    const res = await fetch(`https://api.hunter.io/v2/domain-search?${params}`);
    const data = await res.json();

    if (!res.ok) {
      const detail = data.errors?.[0]?.details || data.errors?.[0]?.id || `HTTP ${res.status}`;
      return { error: `Hunter.io error: ${detail}` };
    }

    const emails: any[] = data.data?.emails ?? [];
    return {
      found: emails.length > 0,
      domain,
      emails: emails.map((e: any) => ({
        email: e.value,
        confidence: e.confidence,
        firstName: e.first_name,
        lastName: e.last_name,
        position: e.position,
        seniority: e.seniority,
      })),
    };
  } catch (err) {
    return { error: `Hunter.io request failed: ${(err as Error).message}` };
  }
}

registerTool('find_email', findEmailTool);
