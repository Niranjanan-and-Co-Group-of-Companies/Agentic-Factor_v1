import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

async function getApiKey(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'apollo')
    .single();
  return data?.access_token ?? null;
}

function noKeyError() {
  return {
    error: 'Apollo.io API key not connected. Please add your Apollo.io API key in the Connectors page.',
    connector_required: true,
    provider: 'apollo',
  };
}

// search_prospects — find people matching ICP criteria from Apollo's database
async function searchProspectsTool({ tenantId, args }: ToolExecutionContext) {
  const apiKey = await getApiKey(tenantId);
  if (!apiKey) return noKeyError();

  const {
    titles = [],
    industries = [],
    employee_ranges = [],
    keywords,
    locations = [],
    limit = 25,
    page = 1,
  } = args as {
    titles?: string[];
    industries?: string[];
    employee_ranges?: string[];   // Apollo format: ["1,10", "11,50", "51,200"]
    keywords?: string;
    locations?: string[];
    limit?: number;
    page?: number;
  };

  const body: Record<string, unknown> = {
    page,
    per_page: Math.min(limit, 100),
  };

  if (titles.length) body.person_titles = titles;
  if (industries.length) body.organization_industry_tag_ids = industries;
  if (employee_ranges.length) body.organization_num_employees_ranges = employee_ranges;
  if (keywords) body.q_keywords = keywords;
  if (locations.length) body.person_locations = locations;

  try {
    const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      return { error: `Apollo.io error: ${data.error || data.message || `HTTP ${res.status}`}` };
    }

    const people = (data.people ?? []).map((p: Record<string, any>) => ({
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      name: p.name,
      title: p.title,
      email: p.email,
      emailStatus: p.email_status,
      linkedinUrl: p.linkedin_url,
      company: p.organization?.name,
      companyDomain: p.organization?.primary_domain,
      companySize: p.organization?.estimated_num_employees,
      industry: p.organization?.industry,
      city: p.city,
      country: p.country,
    }));

    return {
      total: data.pagination?.total_entries ?? people.length,
      page: data.pagination?.page ?? page,
      results: people,
    };
  } catch (err) {
    return { error: `Apollo.io request failed: ${(err as Error).message}` };
  }
}

// enrich_person — get full profile details for a person by email or LinkedIn URL
async function enrichPersonTool({ tenantId, args }: ToolExecutionContext) {
  const apiKey = await getApiKey(tenantId);
  if (!apiKey) return noKeyError();

  const { email, linkedin_url, first_name, last_name, organization_name } = args as {
    email?: string;
    linkedin_url?: string;
    first_name?: string;
    last_name?: string;
    organization_name?: string;
  };

  if (!email && !linkedin_url) {
    return { error: 'Provide at least one of: email, linkedin_url' };
  }

  const body: Record<string, unknown> = { reveal_personal_emails: false };
  if (email) body.email = email;
  if (linkedin_url) body.linkedin_url = linkedin_url;
  if (first_name) body.first_name = first_name;
  if (last_name) body.last_name = last_name;
  if (organization_name) body.organization_name = organization_name;

  try {
    const res = await fetch(`${APOLLO_BASE}/people/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) return { error: `Apollo.io error: ${data.error || `HTTP ${res.status}`}` };

    const p = data.person;
    if (!p) return { found: false };

    return {
      found: true,
      id: p.id,
      name: p.name,
      firstName: p.first_name,
      lastName: p.last_name,
      title: p.title,
      email: p.email,
      emailStatus: p.email_status,
      linkedinUrl: p.linkedin_url,
      headline: p.headline,
      seniority: p.seniority,
      departments: p.departments,
      company: p.organization?.name,
      companyDomain: p.organization?.primary_domain,
      companySize: p.organization?.estimated_num_employees,
      industry: p.organization?.industry,
      city: p.city,
      country: p.country,
    };
  } catch (err) {
    return { error: `Apollo.io request failed: ${(err as Error).message}` };
  }
}

// enrich_company — get company details by domain
async function enrichCompanyTool({ tenantId, args }: ToolExecutionContext) {
  const apiKey = await getApiKey(tenantId);
  if (!apiKey) return noKeyError();

  const { domain } = args as { domain: string };
  if (!domain) return { error: 'Missing required argument: domain' };

  try {
    const res = await fetch(`${APOLLO_BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
      headers: { 'x-api-key': apiKey },
    });

    const data = await res.json();
    if (!res.ok) return { error: `Apollo.io error: ${data.error || `HTTP ${res.status}`}` };

    const org = data.organization;
    if (!org) return { found: false };

    return {
      found: true,
      name: org.name,
      domain: org.primary_domain,
      industry: org.industry,
      description: org.short_description,
      employeeCount: org.estimated_num_employees,
      linkedinUrl: org.linkedin_url,
      websiteUrl: org.website_url,
      city: org.city,
      country: org.country,
      fundingTotal: org.total_funding,
      techStack: (org.technology_names ?? []).slice(0, 10),
    };
  } catch (err) {
    return { error: `Apollo.io request failed: ${(err as Error).message}` };
  }
}

registerTool('search_prospects', searchProspectsTool);
registerTool('enrich_person', enrichPersonTool);
registerTool('enrich_company', enrichCompanyTool);
