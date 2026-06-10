import { createServiceClient } from '@/lib/supabase/server';
import { executeAgent } from './agent-loop';
import { transitionMissionStatus } from '../orchestrator';
import { runPreflightCheck } from '../preflight-validator';

function isEmptyOutput(output: string): boolean {
  if (!output || output.trim() === '') return true;
  try {
    const parsed = JSON.parse(output);
    if (parsed === null || parsed === undefined) return true;
    if (Array.isArray(parsed)) return parsed.length === 0;
    if (typeof parsed === 'object') {
      // Ignore internal metadata keys (prefixed with _)
      const criticalEntries = Object.entries(parsed).filter(([k]) => !k.startsWith('_'));
      if (criticalEntries.length === 0) return true;
      return criticalEntries.every(([, v]) => {
        if (Array.isArray(v)) return v.length === 0;
        if (typeof v === 'string') return v.trim() === '' || v.toLowerCase() === 'null';
        return false; // numbers, booleans, and nested objects are considered non-empty
      });
    }
    return false;
  } catch {
    return output.trim() === '';
  }
}

function buildMissionDiagnosis(errorMsg: string, missionTitle: string): Record<string, string> {
  // EMPTY_DATA_CASCADE
  if (errorMsg.includes('EMPTY_DATA_CASCADE')) {
    const agentMatch = errorMsg.match(/Agent "([^"]+)"/);
    const agentRole = agentMatch?.[1] || 'Data-fetching agent';
    const skippedMatch = errorMsg.match(/(\d+) downstream/);
    const skipped = skippedMatch?.[1] ? `${skippedMatch[1]} downstream agent(s) were skipped` : 'Downstream agents were skipped';
    return {
      failedAt: agentRole,
      attempting: `Fetching data to pass through the "${missionTitle}" pipeline`,
      errorType: 'empty_data',
      error: `${agentRole} returned empty data (empty list or null values). ${skipped} to prevent wasting credits.`,
      actionStep: 'Provide a specific, reachable data source in the mission description — e.g. an exact RSS feed URL, a named Google Drive folder, or a real Slack channel. Vague or guessed sources return no data.',
    };
  }
  // PREFLIGHT_FAILED
  if (errorMsg.includes('PREFLIGHT_FAILED')) {
    const detail = errorMsg.replace('PREFLIGHT_FAILED: ', '');
    const isToken = detail.toLowerCase().includes('oauth') || detail.toLowerCase().includes('connector') || detail.toLowerCase().includes('token');
    const isCredit = detail.toLowerCase().includes('credit') || detail.toLowerCase().includes('insufficient');
    return {
      failedAt: 'Pre-flight check (before any agent ran — no credits consumed)',
      attempting: `Verifying all connectors and credits are ready for "${missionTitle}"`,
      errorType: isToken ? 'auth' : isCredit ? 'credits' : 'preflight',
      error: detail,
      actionStep: isToken
        ? 'Go to the Connectors page and reconnect the required account, then retry.'
        : isCredit
        ? 'Buy a credit top-up from your dashboard, then retry.'
        : 'Resolve each blocker listed above, then retry the mission.',
    };
  }
  // Auth / permission errors
  if (errorMsg.includes('403') || errorMsg.includes('401') || errorMsg.toLowerCase().includes('authentication failed') || errorMsg.toLowerCase().includes('permission denied')) {
    const agentMatch = errorMsg.match(/agent "([^"]+)"/i);
    return {
      failedAt: agentMatch?.[1] || 'Agent',
      attempting: 'Calling an external API with your OAuth credentials',
      errorType: 'auth',
      error: errorMsg,
      actionStep: 'Go to the Connectors page and reconnect the account. Your token may have expired or lost the required API permissions.',
    };
  }
  // Rate limit
  if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('rate limit')) {
    const agentMatch = errorMsg.match(/agent "([^"]+)"/i);
    return {
      failedAt: agentMatch?.[1] || 'Agent',
      attempting: 'Sending requests to an external API',
      errorType: 'rate_limit',
      error: errorMsg,
      actionStep: 'Wait a few minutes and retry. If this recurs on scheduled runs, reduce the run frequency.',
    };
  }
  // Timeout
  if (errorMsg.toLowerCase().includes('timeout') || errorMsg.toLowerCase().includes('timed out')) {
    const agentMatch = errorMsg.match(/agent "([^"]+)"/i);
    return {
      failedAt: agentMatch?.[1] || 'Agent',
      attempting: 'Running the agent script in a cloud sandbox',
      errorType: 'timeout',
      error: errorMsg,
      actionStep: 'The script exceeded the 2-minute limit. Narrow the data scope in the mission description — fewer results, a shorter date range, or a smaller file.',
    };
  }
  // Generic script failure
  const agentMatch = errorMsg.match(/Agent "([^"]+)" failed/);
  return {
    failedAt: agentMatch?.[1] || 'Agent',
    attempting: 'Executing its assigned task',
    errorType: 'script_error',
    error: errorMsg,
    actionStep: 'The agent failed after all retry attempts. Edit the mission with more specific instructions, or check the event log for the raw error details.',
  };
}

export async function executeMission(missionId: string, tenantId: string) {
  const supabase = createServiceClient();

  // Fetch the mission details
  const { data: missionRow, error: missionError } = await supabase
    .from('missions')
    .select('mission_json')
    .eq('id', missionId)
    .eq('tenant_id', tenantId)
    .single();

  if (missionError || !missionRow) {
    console.error(`[Executor] Mission ${missionId} not found.`);
    return;
  }

  // Fetch OAuth tokens for this tenant
  const { data: userTokensRow } = await supabase
    .from('tenant_permissions')
    .select('provider')
    .eq('tenant_id', tenantId);

  const { getValidTokens } = await import('@/lib/services/oauth-refresher');
  const tokens: any[] = [];
  
  if (userTokensRow) {
    for (const t of userTokensRow) {
      const validToken = await getValidTokens(tenantId, t.provider);
      if (validToken) {
        tokens.push(validToken);
      }
    }
  }

  const mission = missionRow.mission_json;
  const orchestration = mission.orchestration;
  const agents = mission.agents;

  // Build a map of agents for quick lookup
  const agentMap = new Map<string, any>(agents.map((a: any) => [a.id, a]));

  let currentAgentId = orchestration.entryAgent;
  let currentContext = '';

  try {
    // ── PRE-FLIGHT CHECK: verify tokens, credits, and mission requirements before any agent runs ──
    const preflight = await runPreflightCheck(missionId, tenantId);
    if (!preflight.ok) {
      const blockerMsg = preflight.blockers.join(' | ');
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'mission.preflight_failed',
        entity_type: 'mission',
        entity_id: missionId,
        payload: { blockers: preflight.blockers, warnings: preflight.warnings },
      });
      throw new Error(`PREFLIGHT_FAILED: ${blockerMsg}`);
    }
    if (preflight.warnings.length > 0) {
      try {
        await supabase.from('events').insert({
          tenant_id: tenantId,
          event_type: 'mission.preflight_warning',
          entity_type: 'mission',
          entity_id: missionId,
          payload: { warnings: preflight.warnings },
        });
      } catch { /* non-fatal */ }
      console.warn(`[Executor] Preflight warnings for mission ${missionId}:`, preflight.warnings);
    }

    // Traverse the graph
    // For MVP, we handle sequential chains natively.
    while (currentAgentId) {
      const agent = agentMap.get(currentAgentId);
      if (!agent) {
        throw new Error(`Agent ${currentAgentId} not found in mission graph.`);
      }

      console.log(`[Executor] Starting agent: ${agent.role} (${agent.id})`);
      
      // Check if this agent is already completed (e.g. if we are resuming after a pause)
      const { data: existingEvents } = await supabase
        .from('events')
        .select('payload')
        .eq('tenant_id', tenantId)
        .eq('event_type', 'agent.completed')
        .eq('entity_id', agent.id)
        .order('created_at', { ascending: false })
        .limit(1);

      // Determine if this is the final agent (hoisted so the empty-data guard can reference it)
      const outEdges = orchestration.edges?.filter((e: any) => e.from === agent.id) || [];
      const isFinalAgent = outEdges.length === 0 && orchestration.pattern !== 'supervisor';

      let output = '';
      if (existingEvents && existingEvents.length > 0 && existingEvents[0].payload.output) {
        console.log(`[Executor] Agent ${agent.role} already completed. Resuming from saved output.`);
        output = existingEvents[0].payload.output;
      } else {
        // Check credits before executing this agent
        const { checkCredits, deductCredits, CREDIT_COSTS, getLLMCostForTier } = await import('@/lib/middleware/billing');
        // First, check with minimum cost to see if any credits available
        const creditCheck = await checkCredits(tenantId, CREDIT_COSTS.code_execution + CREDIT_COSTS.llm_call_flash);
        if (!creditCheck.allowed) {
          console.log(`[Executor] Insufficient credits for agent ${agent.role}. Pausing mission.`);
          await transitionMissionStatus(missionId, tenantId, 'paused');
          return;
        }

        const result = await executeAgent(tenantId, missionId, agent, currentContext, tokens, isFinalAgent, mission.expectedOutputFormat);
        output = result.output;

        // ── Phase 5: Mid-Mission Pause for User Input ──
        if (result.signal?.type === 'user_prompt') {
          console.log(`[Executor] Agent ${agent.role} requested user input. Pausing mission.`);
          
          // Save the pending question with the agent's current state
          await supabase.from('events').insert({
            tenant_id: tenantId,
            event_type: 'mission.awaiting_input',
            entity_type: 'mission',
            entity_id: missionId,
            payload: {
              agentId: agent.id,
              agentRole: agent.role,
              question: result.signal.question,
              options: result.signal.options || [],
              currentOutput: output,
              currentAgentId: currentAgentId,
            },
          });
          
          await transitionMissionStatus(missionId, tenantId, 'awaiting_input');
          
          // Notify user
          try {
            const { notifyMissionStatus } = await import('../notifications');
            await notifyMissionStatus(tenantId, mission.title, missionId, 'awaiting_input');
          } catch (notifyErr) {
            console.warn('[Executor] Notification failed (non-fatal):', notifyErr);
          }
          
          return; // Halt execution — will resume when user answers
        }
        
        if (result.signal?.type === 'missing_permission') {
          console.log(`[Executor] Agent ${agent.role} needs connector: ${result.signal.provider}. Pausing.`);
          await transitionMissionStatus(missionId, tenantId, 'awaiting_input');
          return;
        }

        // --- PHASE 1.3: Working Code Lock ---
        if (result.finalCode && result.finalCode !== agent.pythonScript) {
          console.log(`[Executor] Code healed for Agent ${agent.id}. Locking new code into blueprint...`);
          const { data: missionData } = await supabase
            .from('missions')
            .select('mission_json')
            .eq('id', missionId)
            .single();
            
          if (missionData && missionData.mission_json) {
            const blueprint = missionData.mission_json;
            const agentNode = blueprint.agents?.find((n: any) => n.id === agent.id);
            if (agentNode) {
              agentNode.pythonScript = result.finalCode;
              await supabase
                .from('missions')
                .update({ mission_json: blueprint })
                .eq('id', missionId);
              console.log(`[Executor] Blueprint updated successfully for Agent ${agent.id}.`);
            }
          }
        }
        // Phase 3.5: Wait States
        try {
          const parsedOutput = JSON.parse(output);
          if (parsedOutput.action === 'sleep' || parsedOutput.action === 'schedule') {
            const timeConfig = parsedOutput.duration || parsedOutput.cron;
            console.log(`[Executor] Agent ${agent.role} requested WAIT/SCHEDULE STATE. Time config: ${timeConfig}.`);
            await supabase.from('events').insert({
              tenant_id: tenantId,
              event_type: 'mission.wait',
              entity_type: 'mission',
              entity_id: missionId,
              payload: { 
                action: parsedOutput.action, 
                config: timeConfig, 
                agent: agent.role 
              },
            });
            await transitionMissionStatus(missionId, tenantId, 'paused');
            return;
          }
        } catch (e) {
          // Not JSON, continue normally
        }
      }

      // ── EMPTY DATA GUARD: abort pipeline if a non-final agent returned empty data ──
      // Prevents silent empty-data cascades that waste credits on downstream agents.
      if (!isFinalAgent && isEmptyOutput(output)) {
        const edges = orchestration.edges || [];
        const visited = new Set<string>();
        let scanId: string | null = (edges.find((e: any) => e.from === currentAgentId) as any)?.to ?? null;
        let skippedCount = 0;
        while (scanId && !visited.has(scanId)) {
          visited.add(scanId);
          skippedCount++;
          const next = edges.find((e: any) => e.from === scanId) as any;
          scanId = next?.to ?? null;
        }

        // ── CREDIT REFUND: return credits for every agent that never ran ──
        if (skippedCount > 0) {
          try {
            const { addCredits, CREDIT_COSTS } = await import('@/lib/middleware/billing');
            const refundAmount = skippedCount * (CREDIT_COSTS.code_execution + CREDIT_COSTS.llm_call_pro);
            await addCredits(tenantId, refundAmount, `early_halt:${agent.role}:${skippedCount}_agents_skipped`);
            console.log(`[Executor] Refunded ${refundAmount} credits for ${skippedCount} skipped agent(s).`);
          } catch (refundErr) {
            console.warn('[Executor] Credit refund failed (non-fatal):', refundErr);
          }
        }

        throw new Error(
          `EMPTY_DATA_CASCADE: Agent "${agent.role}" returned empty data. ` +
          `Pipeline halted — ${skippedCount > 0 ? `${skippedCount} downstream agent(s) skipped` : 'no downstream agents to skip'} ` +
          `to prevent wasting credits on empty input. ` +
          `Fix: ensure this agent fetches real data from a valid source (correct URL, API endpoint, folder, or channel).`
        );
      }

      // ═══ ORCHESTRATION PATTERNS ═══
      if (orchestration.pattern === 'supervisor' || orchestration.pattern === 'orchestrator_worker') {
        // Supervisor/Orchestrator pattern: LLM decides next agent dynamically
        const { callLLM } = await import('../llm-router');
        const availableAgents = agents
          .map((a: any) => ({ id: a.id, role: a.role }))
          .filter((a: any) => a.id !== currentAgentId);
        
        console.log(`[Executor] Calling Supervisor Agent to decide next step...`);
        const decision = await callLLM([
          { role: 'system', content: `You are the Mission Supervisor. Based on the previous agent's output and the mission goal, decide which agent should run next. If the goal is fully achieved, return null. Return JSON: {"nextAgentId": "uuid-here" | null, "reasoning": "why"}` },
          { role: 'user', content: `Mission: ${mission.title}\n\nAvailable Agents:\n${JSON.stringify(availableAgents, null, 2)}\n\nPrevious Agent Output:\n${output}` }
        ], { jsonMode: true, tier: 2 });
        
        const decisionData = JSON.parse(decision.content);
        currentAgentId = decisionData.nextAgentId;
        currentContext = output;
        console.log(`[Executor] Supervisor chose next agent: ${currentAgentId || 'NONE (Complete)'}`);
        
      } else if (orchestration.pattern === 'parallel') {
        // Parallel pattern: fan-out all agents that share the same source, then gather
        const outEdges = orchestration.edges.filter((e: any) => e.from === currentAgentId);
        
        if (outEdges.length > 1) {
          // Fan-out: run all target agents in parallel
          console.log(`[Executor] Parallel fan-out: ${outEdges.length} agents from ${currentAgentId}`);
          
          const parallelResults = await Promise.allSettled(
            outEdges.map(async (edge: any) => {
              const parallelAgent = agentMap.get(edge.to);
              if (!parallelAgent) throw new Error(`Agent ${edge.to} not found`);
              
              console.log(`[Executor] [Parallel] Starting agent: ${parallelAgent.role}`);
              const pOutEdges = orchestration.edges?.filter((e: any) => e.from === parallelAgent.id) || [];
              const pIsFinalAgent = pOutEdges.length === 0;
              const result = await executeAgent(tenantId, missionId, parallelAgent, output, tokens, pIsFinalAgent, mission.expectedOutputFormat);
              return { agentId: edge.to, role: parallelAgent.role, output: result.output };
            })
          );
          
          // Merge results: successful outputs become a JSON array, failures are logged
          const mergedOutputs: any[] = [];
          for (const result of parallelResults) {
            if (result.status === 'fulfilled') {
              mergedOutputs.push(result.value);
            } else {
              console.error(`[Executor] [Parallel] Agent failed:`, result.reason);
              mergedOutputs.push({ error: result.reason?.message || 'Agent failed' });
            }
          }
          
          currentContext = JSON.stringify(mergedOutputs);
          
          // Find the gather/sink node — the node that all parallel outputs feed into
          const parallelTargets = new Set(outEdges.map((e: any) => e.to));
          const gatherEdge = orchestration.edges.find((e: any) => 
            parallelTargets.has(e.from) && !parallelTargets.has(e.to)
          );
          
          currentAgentId = gatherEdge?.to || null;
          console.log(`[Executor] Parallel gather node: ${currentAgentId || 'NONE (Complete)'}`);
          
        } else if (outEdges.length === 1) {
          // Single edge, behave like sequential
          currentAgentId = outEdges[0].to;
          currentContext = output;
        } else {
          currentAgentId = null;
        }
        
      } else {
        // Sequential pattern (default): follow the edge chain linearly
        const edge = orchestration.edges.find((e: any) => e.from === currentAgentId);
        if (edge) {
          currentAgentId = edge.to;
          currentContext = output;
        } else {
          currentAgentId = null;
        }
      }

      if (!currentAgentId) {
        // No more edges or Supervisor said null, execution complete
        console.log(`[Executor] End of graph reached. Mission complete.`);
      
        // Log final completion
        await supabase.from('events').insert({
          tenant_id: tenantId,
          event_type: 'mission.completed',
          entity_type: 'mission',
          entity_id: missionId,
          payload: { finalOutput: output },
        });
      }
    }

    // Mark mission as completed
    await transitionMissionStatus(missionId, tenantId, 'completed');

    // Notify user via email
    try {
      const { notifyMissionStatus } = await import('../notifications');
      await notifyMissionStatus(tenantId, mission.title, missionId, 'completed');
    } catch (notifyErr) {
      console.warn('[Executor] Notification failed (non-fatal):', notifyErr);
    }

  } catch (error: any) {
    if (error.message === 'PausedForApproval') {
      console.log(`[Executor] Agent ${currentAgentId} paused for approval. Halting execution chain.`);
      // Notify user about approval needed
      try {
        const { notifyMissionStatus } = await import('../notifications');
        await notifyMissionStatus(tenantId, mission.title, missionId, 'needs_approval');
      } catch (notifyErr) {
        console.warn('[Executor] Notification failed (non-fatal):', notifyErr);
      }
      return;
    }

    console.error(`[Executor] Mission failed:`, error);
    
    // ── STATUS GUARD: Don't overwrite "completed" with "failed" ──
    // If the mission already completed successfully but a late error occurred
    // (e.g., notification email failed), don't mark it as failed
    const { data: currentMission } = await supabase
      .from('missions')
      .select('status')
      .eq('id', missionId)
      .single();

    if (currentMission?.status === 'completed') {
      console.warn(`[Executor] Mission ${missionId} already completed — ignoring late error: ${error.message}`);
      return; // Don't overwrite completed status
    }

    // ── FAILURE DIAGNOSIS: structured report written to mission + events table ──
    // The UI reads validation_report from the missions row to show the user what went wrong.
    try {
      const diagnosis = buildMissionDiagnosis(error.message, mission?.title || 'This mission');
      await supabase.from('missions')
        .update({ validation_report: diagnosis })
        .eq('id', missionId);
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'mission.diagnosis',
        entity_type: 'mission',
        entity_id: missionId,
        payload: diagnosis,
      });
    } catch (diagErr) {
      console.warn('[Executor] Diagnosis report failed (non-fatal):', diagErr);
    }

    await supabase.from('events').insert({
      tenant_id: tenantId,
      event_type: 'mission.failed',
      entity_type: 'mission',
      entity_id: missionId,
      payload: { error: error.message },
    });

    await transitionMissionStatus(missionId, tenantId, 'failed');

    // Notify user about failure
    try {
      const { notifyMissionStatus } = await import('../notifications');
      await notifyMissionStatus(tenantId, mission.title, missionId, 'failed');
    } catch (notifyErr) {
      console.warn('[Executor] Notification failed (non-fatal):', notifyErr);
    }
  }
}
