import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

const EL_BASE = 'https://api.elevenlabs.io/v1';

async function getToken(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_permissions')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', 'elevenlabs')
    .single();
  return data?.access_token ?? null;
}

function noCredError() {
  return { error: 'ElevenLabs not connected. Please add your ElevenLabs API key in the Connectors page.', connector_required: true, provider: 'elevenlabs', connection_type: 'apikey' };
}

async function textToSpeechTool({ tenantId, args }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const { text, voice_id = '21m00Tcm4TlvDq8ikWAM', model_id = 'eleven_monolingual_v1', stability = 0.5, similarity_boost = 0.75, output_format = 'mp3_44100_128' } = args as {
    text: string; voice_id?: string; model_id?: string;
    stability?: number; similarity_boost?: number; output_format?: string;
  };
  if (!text) return { error: 'text is required' };
  const res = await fetch(`${EL_BASE}/text-to-speech/${voice_id}?output_format=${output_format}`, {
    method: 'POST',
    headers: { 'xi-api-key': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id, voice_settings: { stability, similarity_boost } }),
  });
  if (!res.ok) return { error: `ElevenLabs error: HTTP ${res.status}` };
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  return { audio_base64: base64, format: output_format, voice_id, character_count: text.length };
}

async function listVoicesTool({ tenantId }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const res = await fetch(`${EL_BASE}/voices`, { headers: { 'xi-api-key': token } });
  if (!res.ok) return { error: `ElevenLabs error: HTTP ${res.status}` };
  const data = await res.json() as { voices: Array<Record<string, unknown>> };
  return {
    voices: data.voices.map(v => ({
      voice_id: v.voice_id, name: v.name, category: v.category,
      description: (v.labels as Record<string, string> | null)?.description ?? null,
    })),
  };
}

async function getUserInfoTool({ tenantId }: ToolExecutionContext) {
  const token = await getToken(tenantId);
  if (!token) return noCredError();
  const res = await fetch(`${EL_BASE}/user`, { headers: { 'xi-api-key': token } });
  if (!res.ok) return { error: `ElevenLabs error: HTTP ${res.status}` };
  const data = await res.json() as Record<string, unknown>;
  const sub = data.subscription as Record<string, unknown> | null;
  return {
    tier: sub?.tier,
    character_count: sub?.character_count,
    character_limit: sub?.character_limit,
    can_extend_character_limit: sub?.can_extend_character_limit,
  };
}

registerTool('elevenlabs_text_to_speech', textToSpeechTool);
registerTool('elevenlabs_list_voices', listVoicesTool);
registerTool('elevenlabs_get_usage', getUserInfoTool);
