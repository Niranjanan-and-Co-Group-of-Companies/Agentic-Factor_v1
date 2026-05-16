import { createServiceClient } from '../supabase/server';
import type { Mission, AgentDefinition } from '../schemas/mission';

// ============================================================
// Dry Run Executor
// Simulates the first execution cycle of a newly-built agent team.
// All external API calls are mocked. All DB writes are logged
// but NOT committed. Produces a DryRunReport.
// ============================================================

export interface DryRunToolResult {
  toolName: string;
  toolType: string;
  simulated: true;
  mockResponse: Record<string, unknown>;
  latencyEstimateMs: number;
}

export interface DryRunAgentResult {
  agentId: string;
  role: string;
  agentIndex: number;
  status: 'simulated_success' | 'simulated_failure';
  toolResults: DryRunToolResult[];
  estimatedTokens: number;
  notes: string;
}

export interface DryRunReport {
  missionId: string;
  tenantId: string;
  success: boolean;
  executedAt: string;
  totalEstimatedTokens: number;
  totalEstimatedCostUsd: number;
  totalEstimatedLatencyMs: number;
  agentResults: DryRunAgentResult[];
  warnings: string[];
  errors: string[];
}

// Token cost estimate: $0.005 per 1K tokens (GPT-4o average)
const COST_PER_1K_TOKENS = 0.005;

/**
 * Simulate a tool call — returns a mock response based on tool type.
 */
function simulateToolCall(tool: { name: string; type: string }): DryRunToolResult {
  const mockResponses: Record<string, Record<string, unknown>> = {
    api: { status: 200, body: { data: '[simulated API response]' } },
    database: { rows: [], rowCount: 0, query: 'SELECT [simulated]' },
    file_system: { path: '/simulated/output.json', size: 1024 },
    notification: { delivered: true, channel: '[simulated channel]' },
  };

  const latencyEstimates: Record<string, number> = {
    api: 500,
    database: 100,
    file_system: 50,
    notification: 300,
  };

  return {
    toolName: tool.name,
    toolType: tool.type,
    simulated: true,
    mockResponse: mockResponses[tool.type] || { status: 'unknown_type' },
    latencyEstimateMs: latencyEstimates[tool.type] || 200,
  };
}

/**
 * Simulate a single agent's first execution cycle.
 */
function simulateAgent(agent: AgentDefinition): DryRunAgentResult {
  const toolResults = agent.tools.map(simulateToolCall);

  // Estimate token usage based on prompt length + tool count
  const promptTokens = Math.ceil(agent.systemPrompt.length / 4);
  const toolTokens = agent.tools.length * 200; // ~200 tokens per tool interaction
  const estimatedTokens = promptTokens + toolTokens + 500; // 500 for response

  return {
    agentId: agent.id,
    role: agent.role,
    agentIndex: agent.agentIndex,
    status: 'simulated_success',
    toolResults,
    estimatedTokens,
    notes: `Simulated ${agent.tools.length} tool call(s). ${agent.requiresExternalData ? 'Research module would be attached.' : ''}`,
  };
}

/**
 * Execute a dry run of the entire agent team.
 * No real API calls are made. No data is persisted (except the report).
 */
export async function executeDryRun(
  mission: Mission,
  tenantId: string
): Promise<DryRunReport> {
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Simulate each agent
  const agentResults = mission.agents.map((agent) => {
    try {
      return simulateAgent(agent);
    } catch (err) {
      errors.push(`Agent "${agent.role}" simulation failed: ${(err as Error).message}`);
      return {
        agentId: agent.id,
        role: agent.role,
        agentIndex: agent.agentIndex,
        status: 'simulated_failure' as const,
        toolResults: [],
        estimatedTokens: 0,
        notes: `Simulation error: ${(err as Error).message}`,
      };
    }
  });

  // 2. Check for potential issues
  const unauthTools = mission.agents.flatMap((a) =>
    a.tools.filter((t) => t.requiresAuth).map((t) => `${a.role} → ${t.name}`)
  );
  const ungrantedPerms = mission.permissions.filter((p) => !p.granted);

  if (ungrantedPerms.length > 0) {
    warnings.push(
      `${ungrantedPerms.length} permission(s) not yet granted: ${ungrantedPerms.map((p) => p.service).join(', ')}`
    );
  }

  if (unauthTools.length > 0) {
    warnings.push(
      `${unauthTools.length} tool(s) require authentication: ${unauthTools.join('; ')}`
    );
  }

  // Check orchestration edges reference valid agents
  const agentIds = new Set(mission.agents.map((a) => a.id));
  for (const edge of mission.orchestration.edges) {
    if (!agentIds.has(edge.from)) errors.push(`Orchestration edge references unknown agent: ${edge.from}`);
    if (!agentIds.has(edge.to)) errors.push(`Orchestration edge references unknown agent: ${edge.to}`);
  }

  // 3. Calculate totals
  const totalEstimatedTokens = agentResults.reduce((sum, r) => sum + r.estimatedTokens, 0);
  const totalEstimatedCostUsd = (totalEstimatedTokens / 1000) * COST_PER_1K_TOKENS;
  const totalEstimatedLatencyMs = agentResults.reduce(
    (sum, r) => sum + r.toolResults.reduce((s, t) => s + t.latencyEstimateMs, 0),
    0
  );

  const success = errors.length === 0 && agentResults.every((r) => r.status === 'simulated_success');

  const report: DryRunReport = {
    missionId: mission.id,
    tenantId,
    success,
    executedAt: new Date().toISOString(),
    totalEstimatedTokens,
    totalEstimatedCostUsd,
    totalEstimatedLatencyMs,
    agentResults,
    warnings,
    errors,
  };

  // 4. Persist the dry run report to the mission
  const supabase = createServiceClient();
  await supabase
    .from('missions')
    .update({ validation_report: report })
    .eq('id', mission.id)
    .eq('tenant_id', tenantId);

  // 5. Log event
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'mission.dry_run_completed',
    entity_type: 'mission',
    entity_id: mission.id,
    payload: {
      success,
      totalEstimatedTokens,
      totalEstimatedCostUsd,
      warnings: warnings.length,
      errors: errors.length,
    },
  });

  return report;
}
