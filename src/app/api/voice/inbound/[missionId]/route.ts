import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';

export const maxDuration = 30;

// POST /api/voice/inbound/[missionId]
// Vapi (and other voice providers) POST here when a call comes in.
// We create a voice_call record, create a mission_run, and fire the mission.
// The missionId here is the AgenticFactor mission UUID.
//
// Vapi webhook payload: https://docs.vapi.ai/server-url
// Relevant message types: call-start, call-end, transcript, status-update

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> }
) {
  const { missionId } = await params;

  try {
    const body = await request.json() as Record<string, unknown>;
    const messageType = (body.message as Record<string, string> | null)?.type ?? body.type as string ?? 'unknown';
    const callData = (body.message as Record<string, unknown> | null) ?? body;
    const call = callData.call as Record<string, unknown> | null ?? callData;

    const supabase = createServiceClient();

    // Verify the mission exists and get tenant info
    const { data: mission } = await supabase
      .from('missions')
      .select('id, tenant_id, title, status')
      .eq('id', missionId)
      .single();

    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    const callId = call?.id as string ?? `voice_${Date.now()}`;
    const phoneFrom = (call?.customer as Record<string, string> | null)?.number ?? call?.from as string ?? null;
    const phoneTo = (call?.phoneNumber as Record<string, string> | null)?.number ?? call?.to as string ?? null;

    // handle call-start: create records and fire mission
    if (messageType === 'call-start' || messageType === 'call.started' || !messageType.includes('end')) {
      // Upsert voice_call record
      const { data: voiceCall } = await supabase
        .from('voice_calls')
        .upsert({
          tenant_id: mission.tenant_id,
          mission_id: missionId,
          external_id: callId,
          provider: 'vapi',
          direction: 'inbound',
          phone_from: phoneFrom,
          phone_to: phoneTo,
          status: 'in_progress',
          answered_at: new Date().toISOString(),
          metadata: { raw: callData },
        }, { onConflict: 'external_id' })
        .select('id')
        .single();

      // Create a mission_run
      const { data: missionRun } = await supabase
        .from('mission_runs')
        .insert({
          mission_id: missionId,
          tenant_id: mission.tenant_id,
          trigger: 'voice_inbound',
          status: 'running',
          started_at: new Date().toISOString(),
        })
        .select('id, run_number')
        .single();

      if (voiceCall && missionRun) {
        await supabase.from('voice_calls').update({ mission_run_id: missionRun.id }).eq('id', voiceCall.id);
      }

      // Log event
      await supabase.from('events').insert({
        tenant_id: mission.tenant_id,
        mission_id: missionId,
        mission_run_id: missionRun?.id ?? null,
        event_type: 'voice.call.started',
        payload: { call_id: callId, phone_from: phoneFrom, phone_to: phoneTo, provider: 'vapi' },
      });

      // Fire the Inngest mission
      if (missionRun) {
        await inngest.send({
          name: 'mission/trigger',
          data: {
            missionId,
            tenantId: mission.tenant_id,
            runId: missionRun.id,
            trigger: 'voice_inbound',
            context: {
              call_id: callId,
              phone_from: phoneFrom,
              phone_to: phoneTo,
              provider: 'vapi',
            },
          },
        });
      }

      return NextResponse.json({ received: true, run_id: missionRun?.id });
    }

    // handle call-end: update voice_call with transcript and outcome
    if (messageType === 'call-end' || messageType === 'call.ended') {
      const transcript = call?.transcript as string ?? (callData.transcript as string) ?? null;
      const summary = (call?.analysis as Record<string, string> | null)?.summary ?? null;
      const durationMs = call?.endedAt && call?.startedAt
        ? new Date(call.endedAt as string).getTime() - new Date(call.startedAt as string).getTime()
        : null;

      await supabase
        .from('voice_calls')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString(),
          duration_seconds: durationMs ? Math.round(durationMs / 1000) : null,
          transcript,
          summary,
          metadata: { raw: callData },
        })
        .eq('external_id', callId)
        .eq('tenant_id', mission.tenant_id);

      await supabase.from('events').insert({
        tenant_id: mission.tenant_id,
        mission_id: missionId,
        event_type: 'voice.call.ended',
        payload: { call_id: callId, duration_seconds: durationMs ? Math.round(durationMs / 1000) : null, has_transcript: !!transcript },
      });

      return NextResponse.json({ received: true });
    }

    // Other webhook types (transcript chunks, status updates) — acknowledge
    return NextResponse.json({ received: true, type: messageType });

  } catch (err) {
    console.error('[POST /api/voice/inbound]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// GET — for Vapi to verify the endpoint is live
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'AgenticFactor Voice Inbound' });
}
