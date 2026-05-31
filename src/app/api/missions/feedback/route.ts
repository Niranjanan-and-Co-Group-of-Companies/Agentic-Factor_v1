import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { callLLM } from '@/lib/services/llm-router';
import { robustJSONParse } from '@/lib/utils/json-parser';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const { missionId, feedback } = await request.json();

    const supabase = createServiceClient();
    
    // Fetch the mission to get its blueprint
    const { data: missionRow, error } = await supabase
      .from('missions')
      .select('mission_json')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !missionRow) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    const blueprint = missionRow.mission_json;

    // Use LLM to optimize the agents based on the feedback
    const optimizationResponse = await callLLM([
      { role: 'system', content: 'You are an ML Optimization Engine. The user has provided feedback on a completed mission. Your job is to permanently rewrite the "systemPrompt" and "pythonScript" of the agents in the provided JSON blueprint so that they learn from this feedback and do not make the same mistakes next time. Return ONLY the fully updated JSON blueprint. Do not change IDs.' },
      { role: 'user', content: `Current Blueprint:\n${JSON.stringify(blueprint, null, 2)}\n\nUser Feedback:\n${feedback}` }
    ], { jsonMode: true, temperature: 0.1, tier: 1 });

    const updatedBlueprint = robustJSONParse(optimizationResponse.content);

    // Save the optimized blueprint back to the database
    await supabase
      .from('missions')
      .update({ mission_json: updatedBlueprint })
      .eq('id', missionId)
      .eq('tenant_id', tenantId);

    // Record the learning event
    await supabase.from('events').insert({
      tenant_id: tenantId,
      event_type: 'mission.optimized',
      entity_type: 'mission',
      entity_id: missionId,
      payload: { feedback, optimized: true },
    });

    return NextResponse.json({ success: true, blueprint: updatedBlueprint });
  } catch (error: any) {
    console.error('Feedback optimization failed:', error);
    return NextResponse.json({ error: 'Feedback optimization failed', message: error.message }, { status: 500 });
  }
}
