import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 60;

// POST /api/whisper/transcribe
// Accepts a multipart audio blob, transcribes via OpenAI Whisper.
// Uses the tenant's own OpenAI key if connected; falls back to platform key.
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const formData = await request.formData();
    const audio = formData.get('audio') as File | null;
    if (!audio) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Resolve API key — tenant's own key preferred, then platform key
    let apiKey = process.env.OPENAI_API_KEY ?? '';
    try {
      const supabase = createServiceClient();
      const { data } = await supabase
        .from('tenant_permissions')
        .select('access_token')
        .eq('tenant_id', tenantId)
        .eq('provider', 'openai')
        .maybeSingle();
      if (data?.access_token && data.access_token !== 'composio_managed') {
        apiKey = data.access_token as string;
      }
    } catch { /* use platform key */ }

    if (!apiKey) {
      return NextResponse.json({ error: 'Voice input requires an OpenAI API key. Connect OpenAI in the Connectors page.' }, { status: 400 });
    }

    // Forward to OpenAI Whisper
    const whisperForm = new FormData();
    whisperForm.append('file', audio, 'audio.webm');
    whisperForm.append('model', 'whisper-1');
    whisperForm.append('response_format', 'json');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: whisperForm,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[whisper]', err);
      return NextResponse.json({ error: 'Transcription failed. Please try typing your message.' }, { status: 500 });
    }

    const data = await res.json() as { text?: string };
    return NextResponse.json({ text: data.text ?? '' });
  } catch (err) {
    console.error('[whisper/transcribe]', err);
    return NextResponse.json({ error: 'Transcription failed.' }, { status: 500 });
  }
}
