import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'deepgram')
    .single();
  return data?.access_token ?? null;
}

function noCredError() {
  return { error: 'Deepgram not connected. Please add your Deepgram API key in the Connectors page.', connector_required: true, provider: 'deepgram', connection_type: 'apikey' };
}

async function transcribeAudioTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { url, model = 'nova-2', language = 'en', punctuate = true, smart_format = true, summarize = false, detect_topics = false } = args as {
    url: string; model?: string; language?: string;
    punctuate?: boolean; smart_format?: boolean; summarize?: boolean; detect_topics?: boolean;
  };
  if (!url) return { error: 'url (audio file URL) is required' };

  const params = new URLSearchParams({
    model, language,
    punctuate: String(punctuate),
    smart_format: String(smart_format),
    summarize: String(summarize),
    detect_topics: String(detect_topics),
  });

  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) return { error: `Deepgram error: HTTP ${res.status}` };
  const data = await res.json() as Record<string, unknown>;
  const result = (data.results as Record<string, unknown> | null);
  const channel = (result?.channels as Array<Record<string, unknown>> | null)?.[0];
  const alt = (channel?.alternatives as Array<Record<string, unknown>> | null)?.[0];

  return {
    transcript: alt?.transcript ?? '',
    confidence: alt?.confidence ?? 0,
    words: alt?.words ?? [],
    summary: (result?.summary as Record<string, string> | null)?.short ?? null,
    topics: (result?.topics as Record<string, unknown>[] | null) ?? [],
    duration: (data.metadata as Record<string, number> | null)?.duration ?? null,
  };
}

async function getUsageTool({ tenantId }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const res = await fetch('https://api.deepgram.com/v1/projects', {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) return { error: `Deepgram error: HTTP ${res.status}` };
  const data = await res.json() as { projects: Array<Record<string, string>> };
  return { projects: data.projects?.map(p => ({ id: p.project_id, name: p.name })) ?? [] };
}

registerTool('deepgram_transcribe', transcribeAudioTool);
registerTool('deepgram_get_projects', getUsageTool);
