import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const TYPEFORM_BASE = 'https://api.typeform.com';

async function getApiKey(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'typeform')
    .single();
  return data?.access_token ?? null;
}

function noKeyError() {
  return {
    error: 'Typeform API key not connected. Please add your Typeform Personal Access Token in the Connectors page.',
    connector_required: true,
    provider: 'typeform',
  };
}

// list_forms — list all Typeform forms in the account
async function listFormsTool({ tenantId }: ToolExecutionContext) {
  const apiKey = await getApiKey(tenantId);
  if (!apiKey) return noKeyError();

  try {
    const res = await fetch(`${TYPEFORM_BASE}/forms?page_size=50`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json();
    if (!res.ok) return { error: `Typeform error: ${data.description || `HTTP ${res.status}`}` };

    const forms = (data.items ?? []).map((f: Record<string, any>) => ({
      id: f.id,
      title: f.title,
      responseCount: f.response_count,
      lastUpdated: f.last_updated_at,
      link: f._links?.display,
    }));

    return { forms, total: data.total_items ?? forms.length };
  } catch (err) {
    return { error: `Typeform request failed: ${(err as Error).message}` };
  }
}

// get_form_responses — fetch responses for a specific form, optionally since a given date
async function getFormResponsesTool({ tenantId, args }: ToolExecutionContext) {
  const apiKey = await getApiKey(tenantId);
  if (!apiKey) return noKeyError();

  const { form_id, limit = 25, since } = args as {
    form_id: string;
    limit?: number;
    since?: string; // ISO date string — only return responses after this date
  };

  if (!form_id) return { error: 'Missing required argument: form_id' };

  try {
    let url = `${TYPEFORM_BASE}/forms/${form_id}/responses?page_size=${Math.min(limit, 1000)}`;
    if (since) url += `&since=${encodeURIComponent(since)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json();
    if (!res.ok) return { error: `Typeform error: ${data.description || `HTTP ${res.status}`}` };

    const responses = (data.items ?? []).map((r: Record<string, any>) => {
      const answers: Record<string, unknown> = {};
      for (const a of r.answers ?? []) {
        const key = a.field?.ref || a.field?.id || 'unknown';
        answers[key] = a.text ?? a.email ?? a.number ?? a.boolean ?? a.choice?.label ?? a.choices?.labels ?? a.file_url ?? null;
      }
      return {
        responseId: r.response_id,
        submittedAt: r.submitted_at,
        answers,
      };
    });

    return { responses, total: data.total_items ?? responses.length };
  } catch (err) {
    return { error: `Typeform request failed: ${(err as Error).message}` };
  }
}

registerTool('list_forms', listFormsTool);
registerTool('get_form_responses', getFormResponsesTool);
