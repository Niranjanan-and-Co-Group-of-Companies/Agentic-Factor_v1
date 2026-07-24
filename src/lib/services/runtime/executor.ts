import { createServiceClient } from '@/lib/supabase/server';
import { executeAgent } from './agent-loop';
import { transitionMissionStatus, transitionAgentStatus } from '../orchestrator';
import { runPreflightCheck } from '../preflight-validator';

function isEmptyOutput(output: string): boolean {
  if (!output || output.trim() === '') return true;
  try {
    const parsed = JSON.parse(output);
    if (parsed === null || parsed === undefined) return true;
    if (Array.isArray(parsed)) return parsed.length === 0;
    if (typeof parsed === 'object') {
      const criticalEntries = Object.entries(parsed).filter(([k]) => !k.startsWith('_'));
      if (criticalEntries.length === 0) return true;
      return criticalEntries.every(([, v]) => {
        if (Array.isArray(v)) return v.length === 0;
        if (typeof v === 'string') return v.trim() === '' || v.toLowerCase() === 'null';
        return false;
      });
    }
    return false;
  } catch {
    return output.trim() === '';
  }
}

function buildMissionDiagnosis(errorMsg: string, missionTitle: string): Record<string, string> {
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
  const agentMatch = errorMsg.match(/Agent "([^"]+)" failed/);
  return {
    failedAt: agentMatch?.[1] || 'Agent',
    attempting: 'Executing its assigned task',
    errorType: 'script_error',
    error: errorMsg,
    actionStep: 'The agent failed after all retry attempts. Edit the mission with more specific instructions, or check the event log for the raw error details.',
  };
}

export async function executeMission(
  missionId: string,
  tenantId: string,
  options: { runId?: string; trigger?: 'manual' | 'scheduled' | 'webhook' } = {}
) {
  const supabase = createServiceClient();
  const runId = options.runId ?? crypto.randomUUID();
  const trigger = options.trigger ?? 'manual';
  const startedAt = Date.now();

  // Non-fatal helper — Supabase update builder doesn't expose .catch() on its type
  const updateRun = async (updates: Record<string, unknown>) => {
    const { error } = await supabase.from('mission_runs').update(updates).eq('id', runId);
    if (error) console.warn('[Executor] Failed to update mission_runs (non-fatal):', error.message);
  };

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
      if (validToken) tokens.push(validToken);
    }
  }

  const mission = missionRow.mission_json;
  const orchestration = mission.orchestration;
  const agents = mission.agents;

  // Compute run number
  const { count: priorRuns } = await supabase
    .from('mission_runs')
    .select('*', { count: 'exact', head: true })
    .eq('mission_id', missionId);
  const runNumber = (priorRuns ?? 0) + 1;

  // Create mission_runs record for this execution
  const { error: runInsertErr } = await supabase.from('mission_runs').insert({
    id: runId,
    tenant_id: tenantId,
    mission_id: missionId,
    run_number: runNumber,
    trigger,
    status: 'running',
    agents_total: agents.length,
    agents_done: 0,
    agents_failed: 0,
  });
  if (runInsertErr) console.warn('[Executor] Failed to create mission_runs row (non-fatal):', runInsertErr.message);

  const agentMap = new Map<string, any>(agents.map((a: any) => [a.id, a]));

  let currentAgentId = orchestration.entryAgent;
  let currentContext = '';
  let agentsDone = 0;
  let agentsFailed = 0;

  try {
    // ── PRE-FLIGHT CHECK ──
    const preflight = await runPreflightCheck(missionId, tenantId);
    if (!preflight.ok) {
      const blockerMsg = preflight.blockers.join(' | ');
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'mission.preflight_failed',
        entity_type: 'mission',
        entity_id: missionId,
        run_id: runId,
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
          run_id: runId,
          payload: { warnings: preflight.warnings },
        });
      } catch { /* non-fatal */ }
      console.warn(`[Executor] Preflight warnings for mission ${missionId}:`, preflight.warnings);
    }

    while (currentAgentId) {
      const agent = agentMap.get(currentAgentId);
      if (!agent) throw new Error(`Agent ${currentAgentId} not found in mission graph.`);

      console.log(`[Executor] Starting agent: ${agent.role} (${agent.id})`);

      // Check if this agent already completed IN THIS RUN ONLY.
      // The run_id filter is what fixes the recurring-mission bug — without it,
      // run #2 sees run #1's agent.completed events and skips all agents.
      const { data: existingEvents } = await supabase
        .from('events')
        .select('payload')
        .eq('tenant_id', tenantId)
        .eq('event_type', 'agent.completed')
        .eq('entity_id', agent.id)
        .eq('run_id', runId)
        .order('created_at', { ascending: false })
        .limit(1);

      const outEdges = orchestration.edges?.filter((e: any) => e.from === agent.id) || [];
      const isFinalAgent = outEdges.length === 0 && orchestration.pattern !== 'supervisor';

      let output = '';
      if (existingEvents && existingEvents.length > 0 && existingEvents[0].payload.output) {
        console.log(`[Executor] Agent ${agent.role} already completed in this run. Resuming from saved output.`);
        output = existingEvents[0].payload.output;
        agentsDone++;
      } else {
        const { checkCredits, CREDIT_COSTS } = await import('@/lib/middleware/billing');
        const creditCheck = await checkCredits(tenantId, CREDIT_COSTS.code_execution + CREDIT_COSTS.llm_call_flash);
        if (!creditCheck.allowed) {
          console.log(`[Executor] Insufficient credits for agent ${agent.role}. Pausing mission.`);
          await transitionMissionStatus(missionId, tenantId, 'paused');
          await updateRun({ status: 'paused', agents_done: agentsDone, agents_failed: agentsFailed });
          return;
        }

        const result = await executeAgent(
          tenantId, missionId, agent, currentContext, tokens, isFinalAgent, mission.expectedOutputFormat, runId
        );
        output = result.output;

        // ── Mid-Mission Pause for User Input ──
        if (result.signal?.type === 'user_prompt') {
          console.log(`[Executor] Agent ${agent.role} requested user input. Pausing mission.`);
          await supabase.from('events').insert({
            tenant_id: tenantId,
            event_type: 'mission.awaiting_input',
            entity_type: 'mission',
            entity_id: missionId,
            run_id: runId,
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
          await updateRun({ status: 'paused', agents_done: agentsDone, agents_failed: agentsFailed });
          try {
            const { notifyMissionStatus } = await import('../notifications');
            await notifyMissionStatus(tenantId, mission.title, missionId, 'awaiting_input');
          } catch (notifyErr) {
            console.warn('[Executor] Notification failed (non-fatal):', notifyErr);
          }
          return;
        }

        if (result.signal?.type === 'missing_permission') {
          console.log(`[Executor] Agent ${agent.role} needs connector: ${result.signal.provider}. Pausing.`);
          await transitionMissionStatus(missionId, tenantId, 'awaiting_input');
          await updateRun({ status: 'paused', agents_done: agentsDone, agents_failed: agentsFailed });
          return;
        }

        // Code Lock: save healed code back to blueprint
        if (result.finalCode && result.finalCode !== agent.pythonScript) {
          console.log(`[Executor] Code healed for Agent ${agent.id}. Locking new code into blueprint...`);
          const { data: missionData } = await supabase
            .from('missions')
            .select('mission_json')
            .eq('id', missionId)
            .single();
          if (missionData?.mission_json) {
            const blueprint = missionData.mission_json;
            const agentNode = blueprint.agents?.find((n: any) => n.id === agent.id);
            if (agentNode) {
              agentNode.pythonScript = result.finalCode;
              await supabase.from('missions').update({ mission_json: blueprint }).eq('id', missionId);
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
              run_id: runId,
              payload: { action: parsedOutput.action, config: timeConfig, agent: agent.role },
            });
            await transitionMissionStatus(missionId, tenantId, 'paused');
            await updateRun({ status: 'paused', agents_done: agentsDone, agents_failed: agentsFailed });
            return;
          }
        } catch { /* Not JSON, continue normally */ }

        agentsDone++;
      }

      // ── EMPTY DATA GUARD ──
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

      await transitionAgentStatus(agent.id, missionId, tenantId, 'completed').catch((err) =>
        console.warn(`[Executor] Failed to mark agent ${agent.id} completed (non-fatal):`, err)
      );

      // ═══ ORCHESTRATION PATTERNS ═══
      if (orchestration.pattern === 'supervisor' || orchestration.pattern === 'orchestrator_worker') {
        const { callLLM } = await import('../llm-router');
        const availableAgents = agents
          .map((a: any) => ({ id: a.id, role: a.role }))
          .filter((a: any) => a.id !== currentAgentId);
        const decision = await callLLM([
          { role: 'system', content: `You are the Mission Supervisor. Based on the previous agent's output and the mission goal, decide which agent should run next. If the goal is fully achieved, return null. Return JSON: {"nextAgentId": "uuid-here" | null, "reasoning": "why"}` },
          { role: 'user', content: `Mission: ${mission.title}\n\nAvailable Agents:\n${JSON.stringify(availableAgents, null, 2)}\n\nPrevious Agent Output:\n${output}` }
        ], { jsonMode: true, tier: 2 });
        const decisionData = JSON.parse(decision.content);
        currentAgentId = decisionData.nextAgentId;
        currentContext = output;

      } else if (orchestration.pattern === 'parallel') {
        const parallelEdges = orchestration.edges.filter((e: any) => e.from === currentAgentId);
        if (parallelEdges.length > 1) {
          const parallelResults = await Promise.allSettled(
            parallelEdges.map(async (edge: any) => {
              const parallelAgent = agentMap.get(edge.to);
              if (!parallelAgent) throw new Error(`Agent ${edge.to} not found`);
              const pOutEdges = orchestration.edges?.filter((e: any) => e.from === parallelAgent.id) || [];
              const pIsFinalAgent = pOutEdges.length === 0;
              const result = await executeAgent(
                tenantId, missionId, parallelAgent, output, tokens, pIsFinalAgent, mission.expectedOutputFormat, runId
              );
              await transitionAgentStatus(parallelAgent.id, missionId, tenantId, 'completed').catch((err) =>
                console.warn(`[Executor] [Parallel] Failed to mark agent ${parallelAgent.id} completed (non-fatal):`, err)
              );
              return { agentId: edge.to, role: parallelAgent.role, output: result.output };
            })
          );
          const mergedOutputs: any[] = [];
          for (const result of parallelResults) {
            if (result.status === 'fulfilled') { agentsDone++; mergedOutputs.push(result.value); }
            else { agentsFailed++; mergedOutputs.push({ error: result.reason?.message || 'Agent failed' }); }
          }
          currentContext = JSON.stringify(mergedOutputs);
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
        const edge = orchestration.edges.find((e: any) => e.from === currentAgentId);
        if (edge) { currentAgentId = edge.to; currentContext = output; }
        else currentAgentId = null;
      }

      if (!currentAgentId) {
        await supabase.from('events').insert({
          tenant_id: tenantId,
          event_type: 'mission.completed',
          entity_type: 'mission',
          entity_id: missionId,
          run_id: runId,
          payload: { finalOutput: output },
        });
      }
    }

    await transitionMissionStatus(missionId, tenantId, 'completed');

    const durationMs = Date.now() - startedAt;
    await updateRun({ status: 'completed', completed_at: new Date().toISOString(), duration_ms: durationMs, agents_done: agentsDone, agents_failed: agentsFailed });

    try {
      const { notifyMissionRunSummary } = await import('../notifications');
      await notifyMissionRunSummary(tenantId, mission.title, missionId, {
        runNumber, trigger, agentsTotal: agents.length, agentsDone, agentsFailed, durationMs,
      });
    } catch (notifyErr) {
      console.warn('[Executor] Run summary notification failed (non-fatal):', notifyErr);
    }

  } catch (error: any) {
    if (error.message === 'PausedForApproval') {
      console.log(`[Executor] Agent ${currentAgentId} paused for approval.`);
      await updateRun({ status: 'paused', agents_done: agentsDone, agents_failed: agentsFailed });
      try {
        const { notifyMissionStatus } = await import('../notifications');
        await notifyMissionStatus(tenantId, mission.title, missionId, 'needs_approval');
      } catch (notifyErr) {
        console.warn('[Executor] Notification failed (non-fatal):', notifyErr);
      }
      return;
    }

    console.error(`[Executor] Mission failed:`, error);

    // Don't overwrite "completed" with "failed"
    const { data: currentMission } = await supabase
      .from('missions')
      .select('status')
      .eq('id', missionId)
      .single();

    if (currentMission?.status === 'completed') {
      console.warn(`[Executor] Mission ${missionId} already completed — ignoring late error: ${error.message}`);
      return;
    }

    try {
      const diagnosis = buildMissionDiagnosis(error.message, mission?.title || 'This mission');
      await supabase.from('missions').update({ validation_report: diagnosis }).eq('id', missionId);
      await supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'mission.diagnosis',
        entity_type: 'mission',
        entity_id: missionId,
        run_id: runId,
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
      run_id: runId,
      payload: { error: error.message },
    });

    await transitionMissionStatus(missionId, tenantId, 'failed');

    const durationMs = Date.now() - startedAt;
    await updateRun({ status: 'failed', completed_at: new Date().toISOString(), duration_ms: durationMs, agents_done: agentsDone, agents_failed: agentsFailed + 1 });

    try {
      const { notifyMissionStatus } = await import('../notifications');
      await notifyMissionStatus(tenantId, mission.title, missionId, 'failed');
    } catch (notifyErr) {
      console.warn('[Executor] Notification failed (non-fatal):', notifyErr);
    }
  }
}
