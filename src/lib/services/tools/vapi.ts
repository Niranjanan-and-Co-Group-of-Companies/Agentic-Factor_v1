import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const VAPI_BASE = 'https://api.vapi.ai';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'vapi')
    .single();
  return data?.access_token ?? null;
}

function noCredError() {
  return { error: 'Vapi not connected. Please add your Vapi API key in the Connectors page.', connector_required: true, provider: 'vapi', connection_type: 'apikey' };
}

async function vapiApi(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

async function makeCallTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { phone_number_id, customer_number, assistant_id, assistant_overrides, max_duration_seconds = 300 } = args as {
    phone_number_id: string;
    customer_number: string;
    assistant_id?: string;
    assistant_overrides?: Record<string, unknown>;
    max_duration_seconds?: number;
  };
  if (!phone_number_id || !customer_number) return { error: 'phone_number_id and customer_number are required' };
  const payload: Record<string, unknown> = {
    phoneNumberId: phone_number_id,
    customer: { number: customer_number },
    maxDurationSeconds: max_duration_seconds,
  };
  if (assistant_id) payload.assistantId = assistant_id;
  if (assistant_overrides) payload.assistantOverrides = assistant_overrides;
  const { status, data } = await vapiApi(token, '/call', 'POST', payload);
  if (status >= 400) return { error: `Vapi error: ${JSON.stringify(data)}` };
  return { call_id: (data as Record<string, string>).id, status: (data as Record<string, string>).status, created_at: (data as Record<string, string>).createdAt };
}

async function getCallTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { call_id } = args as { call_id: string };
  if (!call_id) return { error: 'call_id is required' };
  const { status, data } = await vapiApi(token, `/call/${call_id}`);
  if (status >= 400) return { error: `Vapi error: ${JSON.stringify(data)}` };
  const d = data as Record<string, unknown>;
  return { call_id: d.id, status: d.status, duration: d.duration, ended_reason: d.endedReason, started_at: d.startedAt, ended_at: d.endedAt };
}

async function getTranscriptTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { call_id } = args as { call_id: string };
  if (!call_id) return { error: 'call_id is required' };
  const { status, data } = await vapiApi(token, `/call/${call_id}`);
  if (status >= 400) return { error: `Vapi error: ${JSON.stringify(data)}` };
  const d = data as Record<string, unknown>;
  return { call_id, transcript: d.transcript, summary: d.summary, messages: d.messages };
}

async function listCallsTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { limit = 20, phone_number_id } = args as { limit?: number; phone_number_id?: string };
  let path = `/call?limit=${Math.min(limit, 100)}`;
  if (phone_number_id) path += `&phoneNumberId=${phone_number_id}`;
  const { status, data } = await vapiApi(token, path);
  if (status >= 400) return { error: `Vapi error: ${JSON.stringify(data)}` };
  return { calls: data };
}

async function createAssistantTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { name, system_prompt, voice_provider = '11labs', voice_id, first_message, end_call_phrases, model = 'gpt-4o' } = args as {
    name: string;
    system_prompt: string;
    voice_provider?: string;
    voice_id?: string;
    first_message?: string;
    end_call_phrases?: string[];
    model?: string;
  };
  if (!name || !system_prompt) return { error: 'name and system_prompt are required' };
  const payload: Record<string, unknown> = {
    name,
    model: { provider: 'openai', model, messages: [{ role: 'system', content: system_prompt }] },
    voice: { provider: voice_provider, voiceId: voice_id ?? 'burt' },
  };
  if (first_message) payload.firstMessage = first_message;
  if (end_call_phrases) payload.endCallPhrases = end_call_phrases;
  const { status, data } = await vapiApi(token, '/assistant', 'POST', payload);
  if (status >= 400) return { error: `Vapi error: ${JSON.stringify(data)}` };
  return { assistant_id: (data as Record<string, string>).id, name: (data as Record<string, string>).name };
}

async function listPhoneNumbersTool({ tenantId }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { status, data } = await vapiApi(token, '/phone-number');
  if (status >= 400) return { error: `Vapi error: ${JSON.stringify(data)}` };
  return { phone_numbers: data };
}

registerTool('vapi_make_call', makeCallTool);
registerTool('vapi_get_call', getCallTool);
registerTool('vapi_get_transcript', getTranscriptTool);
registerTool('vapi_list_calls', listCallsTool);
registerTool('vapi_create_assistant', createAssistantTool);
registerTool('vapi_list_phone_numbers', listPhoneNumbersTool);
