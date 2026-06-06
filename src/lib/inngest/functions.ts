import { inngest } from './client';
import { createServiceClient } from '@/lib/supabase/server';
import { executeAgent } from '@/lib/services/runtime/agent-loop';
import { transitionMissionStatus } from '@/lib/services/orchestrator';

// ═══════════════════════════════════════════════════════════
// Inngest Function: Execute Mission in Background
//
// Each agent runs as a separate Inngest "step" with its own
// timeout (5 min). No more Vercel function timeouts!
//
// Flow:
//   1. Event "mission.execute" received
//   2. Step 1: Fetch mission data + tokens
//   3. Step 2..N: Execute each agent sequentially
//   4. Final step: Mark mission completed
// ═══════════════════════════════════════════════════════════

export const executeMissionBackground = inngest.createFunction(
  {
    id: 'execute-mission',
    name: 'Execute Mission (Background)',
    retries: 1,
    cancelOn: [
      { event: 'mission.cancel', match: 'data.missionId' },
    ],
    triggers: [{ event: 'mission.execute' }],
  },
  async ({ event, step }) => {
    const { missionId, tenantId } = event.data;

    // ── Step 1: Fetch mission data ──
    const missionData = await step.run('fetch-mission', async () => {
      const supabase = createServiceClient();

      const { data: missionRow, error } = await supabase
        .from('missions')
        .select('mission_json')
        .eq('id', missionId)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !missionRow) {
        throw new Error(`Mission ${missionId} not found.`);
      }

      // Fetch OAuth tokens
      const { data: userTokensRow } = await supabase
        .from('tenant_permissions')
        .select('provider')
        .eq('tenant_id', tenantId);

      const { getValidTokens } = await import('@/lib/services/oauth-refresher');
      const tokens: { provider: string; access_token: string }[] = [];

      if (userTokensRow) {
        for (const t of userTokensRow) {
          const validToken = await getValidTokens(tenantId, t.provider);
          if (validToken) {
            tokens.push(validToken);
          }
        }
      }

      return {
        mission: missionRow.mission_json,
        tokens,
      };
    });

    const { mission, tokens } = missionData;
    const orchestration = mission.orchestration;
    const agents = mission.agents;
    const agentMap = new Map<string, any>(agents.map((a: any) => [a.id, a]));

    // ── Sequential Execution: Each agent as its own step ──
    let currentAgentId: string | null = orchestration.entryAgent;
    let currentContext = '';

    try {
      while (currentAgentId) {
        const agent = agentMap.get(currentAgentId);
        if (!agent) {
          throw new Error(`Agent ${currentAgentId} not found in mission graph.`);
        }

        // Capture for closure
        const agentToRun = agent;
        const contextForAgent = currentContext;
        const agentId = currentAgentId;

        // Determine if this is the final agent
        const outEdges = orchestration.edges?.filter((e: any) => e.from === agentId) || [];
        const isFinalAgent = outEdges.length === 0 && orchestration.pattern !== 'supervisor';

        // ── Each agent runs as its own Inngest step (own timeout!) ──
        const agentResult = await step.run(`agent-${agentToRun.role.replace(/\s+/g, '-').toLowerCase()}`, async () => {
          console.log(`[Inngest] Starting agent: ${agentToRun.role} (${agentToRun.id})`);

          const supabase = createServiceClient();

          // Check if already completed (resuming)
          const { data: existingEvents } = await supabase
            .from('events')
            .select('payload')
            .eq('tenant_id', tenantId)
            .eq('event_type', 'agent.completed')
            .eq('entity_id', agentToRun.id)
            .order('created_at', { ascending: false })
            .limit(1);

          if (existingEvents?.length && existingEvents[0].payload.output) {
            console.log(`[Inngest] Agent ${agentToRun.role} already completed. Using cached output.`);
            return { output: existingEvents[0].payload.output, finalCode: agentToRun.pythonScript || '' };
          }

          // Credit check
          const { checkCredits } = await import('@/lib/middleware/billing');
          const creditCheck = await checkCredits(tenantId, 3);
          if (!creditCheck.allowed) {
            console.log(`[Inngest] Insufficient credits for agent ${agentToRun.role}. Pausing.`);
            await transitionMissionStatus(missionId, tenantId, 'paused');
            throw new Error('InsufficientCredits');
          }

          // Execute the agent
          const result = await executeAgent(
            tenantId,
            missionId,
            agentToRun,
            contextForAgent,
            tokens,
            isFinalAgent,
            mission.expectedOutputFormat
          );

          // Code lock: save healed code back to blueprint
          if (result.finalCode && result.finalCode !== agentToRun.pythonScript) {
            console.log(`[Inngest] Code healed for Agent ${agentToRun.id}. Locking into blueprint.`);
            const { data: missionData } = await supabase
              .from('missions')
              .select('mission_json')
              .eq('id', missionId)
              .single();

            if (missionData?.mission_json) {
              const blueprint = missionData.mission_json;
              const agentNode = blueprint.agents?.find((n: any) => n.id === agentToRun.id);
              if (agentNode) {
                agentNode.pythonScript = result.finalCode;
                await supabase
                  .from('missions')
                  .update({ mission_json: blueprint })
                  .eq('id', missionId);
              }
            }
          }

          return result;
        });

        const output = agentResult.output;

        // ── Orchestration: Determine next agent ──
        if (orchestration.pattern === 'supervisor' || orchestration.pattern === 'orchestrator_worker') {
          // Supervisor decides dynamically
          const nextAgent = await step.run(`supervisor-decision-after-${agent.role.replace(/\s+/g, '-')}`, async () => {
            const { callLLM } = await import('@/lib/services/llm-router');
            const availableAgents = agents
              .map((a: any) => ({ id: a.id, role: a.role }))
              .filter((a: any) => a.id !== agentId);

            const decision = await callLLM([
              { role: 'system', content: `You are the Mission Supervisor. Based on the previous agent's output, decide which agent should run next. If the goal is fully achieved, return null. Return JSON: {"nextAgentId": "uuid-here" | null, "reasoning": "why"}` },
              { role: 'user', content: `Mission: ${mission.title}\n\nAvailable Agents:\n${JSON.stringify(availableAgents, null, 2)}\n\nPrevious Agent Output:\n${output}` }
            ], { jsonMode: true, tier: 2 });

            return JSON.parse(decision.content);
          });

          currentAgentId = nextAgent.nextAgentId;
          currentContext = output;

        } else if (orchestration.pattern === 'parallel') {
          const parallelEdges = orchestration.edges.filter((e: any) => e.from === agentId);

          if (parallelEdges.length > 1) {
            // Fan-out: run all parallel agents
            // Note: Inngest steps run sequentially, but we use Promise.allSettled within one step
            const parallelResults = await step.run(`parallel-fanout-from-${agent.role.replace(/\s+/g, '-')}`, async () => {
              console.log(`[Inngest] Parallel fan-out: ${parallelEdges.length} agents`);

              const results = await Promise.allSettled(
                parallelEdges.map(async (edge: any) => {
                  const pAgent = agentMap.get(edge.to);
                  if (!pAgent) throw new Error(`Agent ${edge.to} not found`);
                  const pOutEdges = orchestration.edges?.filter((e: any) => e.from === pAgent.id) || [];
                  const pIsFinal = pOutEdges.length === 0;
                  const result = await executeAgent(tenantId, missionId, pAgent, output, tokens, pIsFinal, mission.expectedOutputFormat);
                  return { agentId: edge.to, role: pAgent.role, output: result.output };
                })
              );

              return results.map(r =>
                r.status === 'fulfilled' ? r.value : { error: (r as PromiseRejectedResult).reason?.message || 'Agent failed' }
              );
            });

            currentContext = JSON.stringify(parallelResults);

            // Find the gather node
            const parallelTargets = new Set(parallelEdges.map((e: any) => e.to));
            const gatherEdge = orchestration.edges.find((e: any) =>
              parallelTargets.has(e.from) && !parallelTargets.has(e.to)
            );
            currentAgentId = gatherEdge?.to || null;

          } else if (parallelEdges.length === 1) {
            currentAgentId = parallelEdges[0].to;
            currentContext = output;
          } else {
            currentAgentId = null;
          }

        } else {
          // Sequential (default)
          const edge = orchestration.edges.find((e: any) => e.from === agentId);
          if (edge) {
            currentAgentId = edge.to;
            currentContext = output;
          } else {
            currentAgentId = null;
          }
        }

        // If no more agents, we're done
        if (!currentAgentId) {
          await step.run('mission-complete', async () => {
            const supabase = createServiceClient();
            console.log(`[Inngest] Mission complete.`);

            await supabase.from('events').insert({
              tenant_id: tenantId,
              event_type: 'mission.completed',
              entity_type: 'mission',
              entity_id: missionId,
              payload: { finalOutput: output },
            });

            await transitionMissionStatus(missionId, tenantId, 'completed');

            // Notify user
            try {
              const { notifyMissionStatus } = await import('@/lib/services/notifications');
              await notifyMissionStatus(tenantId, mission.title, missionId, 'completed');
            } catch (e) {
              console.warn('[Inngest] Notification failed (non-fatal):', e);
            }
          });
        }
      }

      return { success: true, missionId };

    } catch (error: any) {
      // Handle specific error types
      if (error.message === 'PausedForApproval') {
        await step.run('pause-for-approval', async () => {
          try {
            const { notifyMissionStatus } = await import('@/lib/services/notifications');
            await notifyMissionStatus(tenantId, mission.title, missionId, 'needs_approval');
          } catch (e) {
            console.warn('[Inngest] Notification failed:', e);
          }
        });
        return { success: false, reason: 'paused_for_approval' };
      }

      if (error.message === 'InsufficientCredits') {
        return { success: false, reason: 'insufficient_credits' };
      }

      // Mission failed
      await step.run('mission-failed', async () => {
        const supabase = createServiceClient();
        console.error(`[Inngest] Mission failed:`, error.message);

        await supabase.from('events').insert({
          tenant_id: tenantId,
          event_type: 'mission.failed',
          entity_type: 'mission',
          entity_id: missionId,
          payload: { error: error.message },
        });

        await transitionMissionStatus(missionId, tenantId, 'failed');

        try {
          const { notifyMissionStatus } = await import('@/lib/services/notifications');
          await notifyMissionStatus(tenantId, mission.title, missionId, 'failed');
        } catch (e) {
          console.warn('[Inngest] Notification failed:', e);
        }
      });

      throw error; // Let Inngest handle the retry
    }
  }
);

// ═══════════════════════════════════════════════════════════
// Inngest Function: Generate Blueprint in Background
//
// Eliminates Vercel timeout issues by running LLM calls as
// separate Inngest steps. Frontend polls for status.
//
// Flow:
//   1. Event "mission/blueprint.generate" received
//   2. Step 1: Discovery check (ask clarification if needed)
//   3. Step 2: Main blueprint LLM generation
//   4. Step 3: Save result to DB (blueprint_jobs table via events)
// ═══════════════════════════════════════════════════════════

export const generateBlueprintBackground = inngest.createFunction(
  {
    id: 'generate-blueprint',
    name: 'Generate Blueprint (Background)',
    retries: 2,
    triggers: [{ event: 'mission/blueprint.generate' }],
  },
  async ({ event, step }) => {
    const { jobId, intent, tenantId } = event.data;
    const supabase = createServiceClient();

    // Helper: update job status in events table
    const updateJobStatus = async (status: string, data: Record<string, any> = {}) => {
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'blueprint.job_update',
        entity_type: 'blueprint_job',
        entity_id: jobId,
        payload: { jobId, status, ...data, updatedAt: new Date().toISOString() },
      });
    };

    try {
      // ── Step 1: Discovery Check ──
      const discoveryResult = await step.run('discovery-check', async () => {
        await updateJobStatus('processing', { step: 'Analyzing your intent...' });

        const { generateMissionJSON } = await import('@/lib/services/intake');
        const result = await generateMissionJSON(intent, tenantId);

        if (result.isDiscovery && result.question) {
          return { type: 'discovery' as const, question: result.question };
        }

        if (!result.mission) {
          throw new Error('Blueprint generation returned empty.');
        }

        return {
          type: 'blueprint' as const,
          mission: result.mission,
          rawLLMOutput: result.rawLLMOutput,
        };
      });

      // If discovery question, save it and stop
      if (discoveryResult.type === 'discovery') {
        await step.run('save-discovery', async () => {
          await updateJobStatus('discovery', {
            question: discoveryResult.question,
          });
        });
        return { success: true, jobId, type: 'discovery' };
      }

      // ── Step 2: Save blueprint result ──
      await step.run('save-blueprint', async () => {
        const mission = discoveryResult.mission;
        await updateJobStatus('completed', {
          blueprint: mission,
          rawLLMOutput: discoveryResult.rawLLMOutput,
          meta: {
            agentCount: mission.agents.length,
            pattern: mission.orchestration.pattern,
            timeoutSeconds: mission.orchestration.timeoutSeconds,
          },
        });
      });

      // Deduct credit
      await step.run('deduct-credit', async () => {
        const { deductCredits, CREDIT_COSTS } = await import('@/lib/middleware/billing');
        await deductCredits(tenantId, CREDIT_COSTS.llm_call_pro, 'blueprint_generation').catch(() => {});
      });

      return { success: true, jobId, type: 'blueprint' };

    } catch (error: any) {
      // Save error status so frontend can show it
      await step.run('save-error', async () => {
        await updateJobStatus('failed', {
          error: error.message || 'Unknown error',
        });
      });

      throw error;
    }
  }
);
