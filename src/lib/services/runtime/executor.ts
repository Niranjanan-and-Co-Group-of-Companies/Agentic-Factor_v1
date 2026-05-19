import { createServiceClient } from '@/lib/supabase/server';
import { executeAgent } from './agent-loop';
import { transitionMissionStatus } from '../orchestrator';

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

        // Determine if this is the final agent (no outgoing edges)
        const outEdges = orchestration.edges?.filter((e: any) => e.from === agent.id) || [];
        const isFinalAgent = outEdges.length === 0 && orchestration.pattern !== 'supervisor';

        const result = await executeAgent(tenantId, missionId, agent, currentContext, tokens, isFinalAgent, mission.expectedOutputFormat);
        output = result.output;

        // Deduct credits based on ACTUAL model tier (not always flash)
        const actualLLMCost = getLLMCostForTier(creditCheck.modelTier || 'flash');
        const totalCost = CREDIT_COSTS.code_execution + actualLLMCost;
        await deductCredits(tenantId, totalCost, `agent_execution:${agent.role}`).catch(() => {});
        
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
          // If the agent output is JSON and contains a sleep or schedule command
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
            return; // Halt execution chain, cron will wake it later
          }
        } catch (e) {
          // Not JSON, continue normally
        }
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
