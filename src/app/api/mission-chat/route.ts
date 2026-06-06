import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { callLLM } from '@/lib/services/llm-router';
import { editBlueprint } from '@/lib/services/intake';
import { safeJSONParse } from '@/lib/utils/json-parser';

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

CRITICAL BILLING RULES:
- NEVER show raw costs in dollars (e.g. "$0.033") or raw token counts (e.g. "28,244 tokens"). Customers should NEVER see tokens.
- ONLY show "credits used" and "credits remaining". Credits are our customer-facing currency.
- Credits formula: credits = ceil(tokens / 1000 * 0.005 * 4 * 1000). Basically ~20 credits per 1000 tokens.
- When asked about cost, usage, or spending: show "X credits used" and "Y credits remaining this month" only.
- NEVER mention tokens, token counts, underlying cost per token, LLM pricing, or profit margins.
- NEVER show "Total tokens used" — that is internal data. Only show credits.
- Example: If a mission used 6,677 tokens, say "~134 credits used", NOT "6,677 tokens" or "$0.033".
- Format usage like: "📊 Credits Used: ~134 credits | Remaining: ~866 credits"

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
    ], { jsonMode: true, temperature: 0.2, tier: 2, budgetContext: { tenantId, missionId } });

    let parsedResponse: any;
    try {
      parsedResponse = safeJSONParse(response.content, { reply: response.content });
    } catch {
      // LLM returned non-JSON, use content as-is
      parsedResponse = { reply: response.content };
    }

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
    const errMsg = (err as Error).message || 'Unknown error';
    console.error('[POST /api/mission-chat]', errMsg);
    
    // Surface specific error types
    if (errMsg.includes('Rate limit') || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
      return NextResponse.json({ 
        error: 'The AI is temporarily busy. Please try again in a few seconds.',
        reply: 'I\'m temporarily unavailable due to high demand. Please try again in a moment.' 
      }, { status: 429 });
    }
    
    if (errMsg.includes('No LLM provider')) {
      return NextResponse.json({ 
        error: 'AI service unavailable',
        reply: 'The AI service is currently down. Our team has been notified.' 
      }, { status: 503 });
    }
    
    return NextResponse.json({ 
      error: 'Failed to process chat',
      reply: 'Sorry, I encountered an error. Please try again.' 
    }, { status: 500 });
  }
}
