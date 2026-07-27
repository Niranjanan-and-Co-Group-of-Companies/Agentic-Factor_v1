import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

// Universal custom connector tool — lets agents call ANY API the customer
// has configured via the "Add Custom API" flow on the Connectors page.
// Credentials stored in tenant_permissions WHERE provider LIKE 'custom_%'

interface CustomConnectorRecord {
  access_token: string;
  metadata: {
    display_name: string;
    base_url: string | null;
    auth_type: string;
    auth_header: string | null;
  } | null;
}

async function getCustomConnector(tenantId: string, name: string): Promise<CustomConnectorRecord | null> {
  const supabase = createServiceClient();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const provider = slug.startsWith('custom_') ? slug : `custom_${slug}`;

  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token, metadata')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .single();

  return data as CustomConnectorRecord | null;
}

function buildAuthHeader(record: CustomConnectorRecord): Record<string, string> {
  const authType = record.metadata?.auth_type ?? 'bearer';
  const customHeader = record.metadata?.auth_header;
  const key = record.access_token;

  if (customHeader) return { [customHeader]: key };

  switch (authType.toLowerCase()) {
    case 'bearer': return { Authorization: `Bearer ${key}` };
    case 'apikey': return { 'X-API-Key': key };
    case 'basic': return { Authorization: `Basic ${Buffer.from(key).toString('base64')}` };
    case 'token': return { Authorization: `Token ${key}` };
    default: return { Authorization: `Bearer ${key}` };
  }
}

async function customApiCallTool({ tenantId, args }: ToolExecutionContext) {
  const {
    connector_name,
    method = 'GET',
    path,
    url,
    body,
    query_params,
    extra_headers,
  } = args as {
    connector_name: string;
    method?: string;
    path?: string;
    url?: string;
    body?: Record<string, unknown>;
    query_params?: Record<string, string>;
    extra_headers?: Record<string, string>;
  };

  if (!connector_name) return { error: 'connector_name is required' };
  if (!path && !url) return { error: 'Either path (relative to base_url) or url (full URL) is required' };

  const record = await getCustomConnector(tenantId, connector_name);
  if (!record) {
    return {
      error: `Custom connector "${connector_name}" not found. Please add it on the Connectors page.`,
      connector_required: true,
      provider: `custom_${connector_name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      connection_type: 'custom',
    };
  }

  const baseUrl = record.metadata?.base_url?.replace(/\/$/, '') ?? '';
  let fullUrl = url ?? `${baseUrl}${path?.startsWith('/') ? path : `/${path}`}`;

  if (query_params && Object.keys(query_params).length > 0) {
    const qs = new URLSearchParams(query_params).toString();
    fullUrl += `${fullUrl.includes('?') ? '&' : '?'}${qs}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeader(record),
    ...(extra_headers ?? {}),
  };

  try {
    const res = await fetch(fullUrl, {
      method: method.toUpperCase(),
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data: unknown;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    return {
      status: res.status,
      ok: res.ok,
      data,
      connector: connector_name,
      url: fullUrl,
    };
  } catch (err) {
    return { error: `Request failed: ${(err as Error).message}`, connector: connector_name };
  }
}

async function listCustomConnectorsTool({ tenantId }: ToolExecutionContext) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('provider, metadata')
    .eq('tenant_id', tenantId)
    .contains('scopes', ['custom'])
    .order('updated_at', { ascending: false });

  if (!data?.length) return { connectors: [], message: 'No custom connectors added yet. Add one on the Connectors page.' };

  return {
    connectors: data.map(r => ({
      name: (r.metadata as Record<string, string> | null)?.display_name ?? r.provider,
      provider: r.provider,
      base_url: (r.metadata as Record<string, string> | null)?.base_url ?? null,
    })),
  };
}

registerTool('custom_api_call', customApiCallTool);
registerTool('list_custom_connectors', listCustomConnectorsTool);
