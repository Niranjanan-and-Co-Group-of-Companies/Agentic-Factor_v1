import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';

export const maxDuration = 300;

const ResumeRequest = z.object({
  missionId: z.string().uuid(),
  answer: z.string().min(1, 'Answer is required'),
});

/**
 * POST /api/missions/resume
 * Resumes a paused mission that was waiting for user input.
 * 
 * Flow:
 * 1. Validate the mission is in 'awaiting_input' status
 * 2. Find the pending question from events
 * 3. Inject the user's answer into the agent's context
 * 4. Resume execution from the paused agent
 */
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const body = await request.json();
    const { missionId, answer } = ResumeRequest.parse(body);

    const supabase = createServiceClient();

    // 1. Fetch mission and verify it's awaiting input
    const { data: missionRow, error: missionError } = await supabase
      .from('missions')
      .select('status, mission_json')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();

    if (missionError || !missionRow) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    if (missionRow.status !== 'awaiting_input') {
      return NextResponse.json({ 
        error: `Mission is not awaiting input (current status: ${missionRow.status})` 
      }, { status: 400 });
    }

    // 2. Find the pending question event
    const { data: pendingEvent } = await supabase
      .from('events')
      .select('payload')
      .eq('tenant_id', tenantId)
      .eq('entity_id', missionId)
      .eq('event_type', 'mission.awaiting_input')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!pendingEvent?.payload) {
      return NextResponse.json({ error: 'No pending question found' }, { status: 404 });
    }

    const { agentId, agentRole, question, currentOutput, currentAgentId } = pendingEvent.payload as any;

    // 3. Log the user's answer
    await supabase.from('events').insert({
      tenant_id: tenantId,
      event_type: 'mission.user_answered',
      entity_type: 'mission',
      entity_id: missionId,
      payload: { 
        agentId, 
        question, 
        answer,
        answeredAt: new Date().toISOString(),
      },
    });

    // 4. Transition status back to running
    const { transitionMissionStatus } = await import('@/lib/services/orchestrator');
    await transitionMissionStatus(missionId, tenantId, 'running');

    // 5. Resume execution — inject the answer into context and continue from the paused agent
    // The answer gets appended to the previous output so the agent can use it
    const enrichedContext = JSON.stringify({
      ...(currentOutput ? JSON.parse(currentOutput) : {}),
      __user_answer__: {
        question,
        answer,
        answeredAt: new Date().toISOString(),
      },
    });

    // Save the enriched context as the agent's completed output so executor skips it
    await supabase.from('events').insert({
      tenant_id: tenantId,
      event_type: 'agent.completed',
      entity_type: 'agent',
      entity_id: agentId,
      payload: { missionId, output: enrichedContext },
    });

    // 6. Trigger re-execution from the NEXT agent (the current agent already produced output)
    // The Inngest scheduler or cron will pick this up, but we can also trigger it directly
    try {
      const { executeMission } = await import('@/lib/services/runtime/executor');
      // Fire and forget — don't wait for the full execution
      executeMission(missionId, tenantId).catch((err) => {
        console.error(`[Resume] Mission re-execution failed:`, err);
      });
    } catch (execErr) {
      console.error('[Resume] Failed to trigger execution:', execErr);
    }

    return NextResponse.json({ 
      success: true, 
      message: `Mission resumed. Answer "${answer}" has been recorded.`,
      resumedFrom: agentRole,
    });

  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: error.issues }, { status: 400 });
    }
    console.error('Mission resume failed:', error);
    return NextResponse.json({ error: 'Failed to resume mission', message: error.message }, { status: 500 });
  }
}
