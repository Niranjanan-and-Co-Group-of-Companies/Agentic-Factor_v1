import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { callLLM } from '@/lib/services/llm-router';
import { editBlueprint } from '@/lib/services/intake';
import { safeJSONParse } from '@/lib/utils/json-parser';
import { processApprovalDecision } from '@/lib/services/approvals';

export const maxDuration = 120;

// Sent by the mission page on load (not typed by the user) to let the Chief
// of Staff proactively check in when there's a pending approval, instead of
// waiting for the user to ask. Never shown as a user chat bubble — the
// frontend only renders the resulting assistant reply, if any.
const SYSTEM_CHECKIN_TOKEN = '__SYSTEM_CHECKIN__';

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;

  const { tenantId } = authResult;

  try {
    const { missionId, message } = await request.json();
    if (!missionId || !message) {
      return NextResponse.json({ error: 'Missing missionId or message' }, { status: 400 });
    }
    const isSilentCheckin = message === SYSTEM_CHECKIN_TOKEN;

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

    // ── Fetch REAL billing data for this tenant ──
    const { data: billingRow } = await supabase
      .from('tenant_billing')
      .select('plan, credits_remaining, credits_topup, credits_total, credits_used_this_month')
      .eq('tenant_id', tenantId)
      .single();

    // Fetch connected providers — names only, never expose keys/tokens
    const { data: connectorPerms } = await supabase
      .from('tenant_permissions')
      .select('provider')
      .eq('tenant_id', tenantId);
    const connectedProviderNames = connectorPerms?.map(p => p.provider) ?? [];

    // ── Fetch the most recent pending approval for this mission, if any ──
    // The Chief of Staff surfaces this conversationally instead of leaving
    // it to a separate Approve/Reject button screen — only the most recent
    // one is handled per turn; approving it lets the next one (if any)
    // surface on the following message.
    const { data: pendingActions } = await supabase
      .from('proposed_actions')
      .select('id, agent_role, description, explanation, target, risk_level, reversible, payload')
      .eq('mission_id', missionId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('submitted_at', { ascending: false })
      .limit(1);
    const pendingAction = pendingActions?.[0] || null;

    // A silent check-in with nothing pending has nothing to say — skip the
    // LLM call entirely rather than returning a generic "all good" message
    // the user never asked for.
    if (isSilentCheckin && !pendingAction) {
      return NextResponse.json({ reply: null });
    }

    const creditsRemaining = billingRow?.credits_remaining ?? 0;
    const creditsTopup = billingRow?.credits_topup ?? 0;
    const creditsTotal = billingRow?.credits_total ?? 1000;
    const creditsUsedThisMonth = billingRow?.credits_used_this_month ?? 0;
    const plan = billingRow?.plan ?? 'free';

    // ── Fetch credits used specifically for THIS mission ──
    const { data: missionCreditEvents } = await supabase
      .from('events')
      .select('payload')
      .eq('tenant_id', tenantId)
      .eq('event_type', 'billing.credit_used')
      .filter('payload->>actionType', 'not.is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    // Sum up credits used that are related to this mission's agents
    const agentIds = new Set((missionRow.mission_json.agents || []).map((a: any) => a.id));
    const agentRoles = new Set((missionRow.mission_json.agents || []).map((a: any) => a.role));
    let missionCreditsUsed = 0;
    const creditBreakdown: { action: string; credits: number }[] = [];
    
    if (missionCreditEvents) {
      for (const ev of missionCreditEvents) {
        const p = ev.payload;
        const actionType = p?.actionType || '';
        // Match events belonging to this mission's agents by role name in action string
        const isThisMission = Array.from(agentRoles).some(role => 
          actionType.includes(String(role))
        ) || actionType.includes('blueprint');
        
        if (isThisMission && p?.amount) {
          missionCreditsUsed += p.amount;
          creditBreakdown.push({ action: actionType, credits: p.amount });
        }
      }
    }

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
- Use ONLY the REAL billing data provided below. NEVER estimate or calculate credits from tokens.
- NEVER show raw token counts, dollar costs, or mention "tokens" at all. Tokens are internal data.
- NEVER mention profit margins, LLM pricing, or cost per token.
- When asked about usage/cost, use this REAL data:
  📊 Credits used by this mission: ${missionCreditsUsed} credits
  📊 Monthly credits remaining: ${creditsRemaining} / ${creditsTotal}
  📊 Top-up credits: ${creditsTopup} (purchased, never expire)
  📊 Total available: ${creditsRemaining + creditsTopup} credits
  📊 Plan: ${plan}
  📊 Total credits used this month: ${creditsUsedThisMonth} credits

CONNECTED INTEGRATIONS (live from database — do NOT expose keys or tokens):
${connectedProviderNames.length > 0
  ? connectedProviderNames.map(p => `• ${p} ✅ connected`).join('\n')
  : '• None connected yet'}
When asked about connector status, use ONLY the above list. Never say "I don't know" if the answer is here.

CURRENT LIVE MISSION STATUS: "${missionRow.status}"

MISSION CONFIGURATION:
${JSON.stringify(missionRow.mission_json, null, 2)}

RECENT EVENTS:
${JSON.stringify(eventRows || [], null, 2)}
${pendingAction ? `
PENDING APPROVAL — AN AGENT IS WAITING ON YOUR DECISION:
Agent "${pendingAction.agent_role}" wants to perform an action and is paused until you decide.
- What it wants to do: ${pendingAction.description}
- Why it's asking: ${pendingAction.explanation || 'No additional explanation provided.'}
- Target service: ${pendingAction.target}
- Risk: ${pendingAction.risk_level}${pendingAction.reversible ? '' : ' — IRREVERSIBLE, cannot be undone once it runs'}
- Preview of what it would actually do/send:
${JSON.stringify(pendingAction.payload?.output ?? {}, null, 2).slice(0, 800)}

YOUR JOB ABOUT THIS PENDING APPROVAL:
- If you have not already told the user about this in this conversation, mention it clearly in your reply and show them the actual preview content above — don't just say "there's something pending," show them what it says.
- If the user's message is an unambiguous approval of THIS pending action ("yes", "go ahead", "send it", "approve", "looks good", "do it"), set "approval_decision" to "approved".
- If the user's message is an unambiguous rejection ("no", "don't", "reject", "cancel that", "skip it"), set "approval_decision" to "rejected".
- If their message is about something unrelated, answer that normally, but still briefly remind them this is still pending at the end of your reply.
- Do NOT set "approval_decision" unless their intent is clear — when in doubt, ask them to confirm instead of guessing.
` : ''}
You MUST respond in valid JSON format matching this schema:
{
  "reply": "Your response to the user, including any requested CSV or Markdown tables/diagrams.",
  "mutation_instruction": "A clear, concise instruction for the AI Architect to modify the blueprint (e.g., 'Add a Twitter agent'). Only include this if the user EXPLICITLY asks to change the mission. Otherwise, omit this field or set it to null.",
  "approval_decision": "Set to 'approved' or 'rejected' ONLY if there is a pending approval above AND the user just gave a clear, unambiguous decision on it this message. Omit or set to null otherwise."
}`;

    // Chat uses callLLM without budgetContext so the circuit breaker (designed for
    // agent execution loops) never blocks a user conversation mid-session.
    // callLLM cascades internally: Claude → Gemini → OpenAI on any 429/rate-limit.
    const userTurnContent = isSilentCheckin
      ? 'The user just opened this mission. Proactively introduce the pending approval described above — do not say anything else.'
      : message;
    const response = await callLLM([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userTurnContent }
    ], { jsonMode: true, temperature: 0.2, tier: 2 });

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

    // If the user just gave a clear decision on the pending approval, act on it
    // through the same shared logic the Approve/Reject buttons use.
    if (pendingAction && (parsedResponse.approval_decision === 'approved' || parsedResponse.approval_decision === 'rejected')) {
      const result = await processApprovalDecision(tenantId, pendingAction.id, parsedResponse.approval_decision, missionId);

      if (result.ok) {
        parsedResponse.reply += result.decision === 'approved'
          ? `\n\n✅ Done — approved, and the mission is continuing.`
          : `\n\n❌ Got it — rejected. The mission will not perform that action.`;
      } else if (result.reason === 'missing_permission') {
        parsedResponse.reply += `\n\n⚠️ I tried to approve that, but you're missing a required connection: ${result.providers.join(', ')}. Connect it on the Connectors page, then let me know and I'll try again.`;
      } else if (result.reason === 'circuit_breaker') {
        parsedResponse.reply += `\n\n⚠️ I couldn't process that right now — the system is temporarily rate-limited. Try again shortly.`;
      } else {
        parsedResponse.reply += `\n\n⚠️ Something went wrong processing that: ${result.message}`;
      }
    }

    return NextResponse.json({ reply: parsedResponse.reply });

  } catch (err) {
    const errMsg = (err as Error).message || 'Unknown error';
    console.error('[POST /api/mission-chat]', errMsg);
    
    // All providers in the cascade exhausted (Claude → Gemini → OpenAI all rate-limited)
    if (errMsg.includes('No LLM provider') || errMsg.includes('models exhausted')) {
      return NextResponse.json({
        error: 'AI service temporarily unavailable',
        reply: 'All AI providers are temporarily rate-limited. Please try again in 30 seconds.',
      }, { status: 503 });
    }

    // Single-provider rate limit surfaced before cascade could run (defensive)
    if (errMsg.includes('Rate limit') || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
      return NextResponse.json({
        error: 'The AI is temporarily busy. Please try again in a few seconds.',
        reply: 'I\'m temporarily unavailable due to high demand. Please try again in a moment.'
      }, { status: 429 });
    }

    return NextResponse.json({
      error: 'Failed to process chat',
      reply: 'Sorry, I encountered an error. Please try again.'
    }, { status: 500 });
  }
}
