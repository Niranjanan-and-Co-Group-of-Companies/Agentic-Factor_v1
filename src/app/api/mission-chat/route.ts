import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { callLLM } from '@/lib/services/llm-router';
import { editBlueprint } from '@/lib/services/intake';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;

  const { tenantId } = authResult;

  try {
    const { missionId, message } = await request.json();
    if (!missionId || !message) {
      return NextResponse.json({ error: 'Missing missionId or message' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Fetch the mission to ensure it belongs to the tenant
    const { data: missionRow, error: missionError } = await supabase
      .from('missions')
      .select('mission_json, status')
      .eq('id', missionId)
      .eq('tenant_id', tenantId)
      .single();

    if (missionError || !missionRow) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    // Fetch recent events for context
    const { data: eventRows } = await supabase
      .from('events')
      .select('event_type, payload, created_at')
      .eq('entity_id', missionId)
      .order('created_at', { ascending: false })
      .limit(20);

const SYSTEM_PROMPT = `You are the Chief of Staff for the mission titled "${missionRow.mission_json.title}".
Your purpose is to oversee the entire mission, manage the sub-agents, and synthesize information for the user.
You have access to the mission's configuration (mission_json) and recent event logs.

CAPABILITIES:
1. You can format data for the user. If they ask for a CSV or flowchart, generate the raw CSV data or Mermaid.js markdown directly in your reply.
2. You can dynamically update the mission! If the user asks to add an agent, change a schedule, or mutate the architecture, you MUST provide a concise "mutation_instruction" field describing the requested change. The backend will automatically apply it.

STRICT BOUNDARIES:
1. ONLY answer questions related to THIS mission's status, agents, goals, or events.
2. If the user asks anything outside the scope of this mission, respectfully decline.

CURRENT LIVE MISSION STATUS: "${missionRow.status}"

MISSION CONFIGURATION:
${JSON.stringify(missionRow.mission_json, null, 2)}

RECENT EVENTS:
${JSON.stringify(eventRows || [], null, 2)}

You MUST respond in valid JSON format matching this schema:
{
  "reply": "Your response to the user, including any requested CSV or Markdown tables/diagrams.",
  "mutation_instruction": "A clear, concise instruction for the AI Architect to modify the blueprint (e.g., 'Add a Twitter agent'). Only include this if the user EXPLICITLY asks to change the mission. Otherwise, omit this field or set it to null."
}`;

    const response = await callLLM([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message }
    ], { jsonMode: true, temperature: 0.2, tier: 1 });

    const parsedResponse = JSON.parse(response.content);

    // If the LLM decided we need to mutate the blueprint, apply it automatically!
    if (parsedResponse.mutation_instruction) {
      console.log(`[Chief of Staff] Triggering blueprint mutation: ${parsedResponse.mutation_instruction}`);
      const updatedBlueprint = await editBlueprint(missionRow.mission_json, parsedResponse.mutation_instruction);
      
      await supabase
        .from('missions')
        .update({ mission_json: updatedBlueprint })
        .eq('id', missionId)
        .eq('tenant_id', tenantId);
        
      parsedResponse.reply += '\n\n*(Mission architecture has been dynamically updated based on your request!)*';
    }

    return NextResponse.json({ reply: parsedResponse.reply });

  } catch (err) {
    console.error('[POST /api/mission-chat]', err);
    return NextResponse.json({ error: 'Failed to process chat' }, { status: 500 });
  }
}
