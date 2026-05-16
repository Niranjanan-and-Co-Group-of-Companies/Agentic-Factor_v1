import { createServiceClient } from '../supabase/server';
import { captureSnapshot } from './snapshots';
import { touchHeartbeat } from './deadlock-detector';
import { redactPayload } from '../middleware/redactor';
import type { Mission } from '../schemas/mission';
import type { ProvisionedAgent } from './orchestrator';

// ============================================================
// Validation Agent — The Quality Gate
//
// Every mission must conclude with a Validation Agent that runs
// the auto-generated validationChecklist against all worker
// outputs before transitioning to 'pending_approval' (HITL).
// ============================================================

export interface ChecklistItem {
  index: number;
  assertion: string;
  passed: boolean;
  evidence: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface ValidationReport {
  missionId: string;
  tenantId: string;
  executedAt: string;
  passed: boolean;
  score: number;           // 0.0 – 1.0
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  checklist: ChecklistItem[];
  agentSummaries: AgentValidationSummary[];
  recommendation: 'approve' | 'review' | 'reject';
}

export interface AgentValidationSummary {
  agentId: string;
  role: string;
  status: string;
  outputValid: boolean;
  notes: string;
}

// ============================================================
// Checklist Evaluation Engine
// Runs each assertion against available agent data.
// In production, this would use an LLM to evaluate assertions
// against actual agent outputs. For scaffold, uses heuristic
// checks with simulated outputs.
// ============================================================

function evaluateChecklistItem(
  assertion: string,
  index: number,
  agents: ProvisionedAgent[],
  mission: Mission
): ChecklistItem {
  const assertionLower = assertion.toLowerCase();

  // Heuristic: check if assertion references specific agent capabilities
  const relevantAgents = agents.filter((a) =>
    a.capabilities.some((cap) => assertionLower.includes(cap.replace(/_/g, ' ')))
  );

  // Heuristic: check if assertion references data/format requirements
  const dataKeywords = ['contains', 'includes', 'valid', 'format', 'at least', 'generated'];
  const hasDataCheck = dataKeywords.some((kw) => assertionLower.includes(kw));

  // Simulate evaluation: agents that are 'running' or 'completed' pass
  const allRelevantRunning = relevantAgents.length === 0 || relevantAgents.every(
    (a) => a.status === 'running' || a.status === 'completed'
  );

  // Check if required permissions are granted
  const permKeywords = ['connection', 'api', 'access', 'accessible', 'authenticated', 'authorized', 'token'];
  const isPermCheck = permKeywords.some((kw) => assertionLower.includes(kw));
  const permsPassed = !isPermCheck || mission.permissions.every((p) => p.granted);

  // Tool-type-specific checks (expanded for new types)
  const toolTypeKeywords: Record<string, string[]> = {
    web_search: ['search', 'web', 'browse', 'crawl', 'scrape', 'fetch url'],
    llm_reasoning: ['reason', 'analyze', 'interpret', 'summarize', 'generate text', 'compose'],
    social_media: ['slack', 'linkedin', 'twitter', 'social', 'post', 'reply', 'message'],
    messaging: ['slack', 'teams', 'discord', 'chat', 'dm', 'direct message', 'channel'],
    scraping: ['scrape', 'extract', 'parse', 'html', 'dom', 'crawl'],
    crm: ['salesforce', 'hubspot', 'crm', 'lead', 'contact', 'deal', 'pipeline'],
    analytics: ['analytics', 'metrics', 'dashboard', 'report', 'chart', 'trend'],
  };

  const matchedToolType = Object.entries(toolTypeKeywords).find(([, keywords]) =>
    keywords.some(kw => assertionLower.includes(kw))
  );

  // If assertion references a specific tool type, check agents have matching tools
  let toolTypeValid = true;
  if (matchedToolType) {
    const [type] = matchedToolType;
    const hasAgent = agents.some(a =>
      a.capabilities.some(cap => toolTypeKeywords[type]?.some(kw => cap.includes(kw))) ||
      (a.config && JSON.stringify(a.config).toLowerCase().includes(type))
    );
    toolTypeValid = hasAgent || relevantAgents.length > 0;
  }

  const passed = allRelevantRunning && (!isPermCheck || permsPassed) && toolTypeValid;

  // Determine severity
  let severity: 'critical' | 'warning' | 'info' = 'info';
  if (assertionLower.includes('critical') || assertionLower.includes('security')) severity = 'critical';
  else if (isPermCheck || assertionLower.includes('valid') || assertionLower.includes('authenticated')) severity = 'warning';
  else if (hasDataCheck || matchedToolType) severity = 'warning';

  return {
    index,
    assertion,
    passed,
    evidence: passed
      ? `Verified: ${relevantAgents.length > 0 ? relevantAgents.map((a) => a.role).join(', ') : 'system check'} — all conditions met${matchedToolType ? ` (${matchedToolType[0]} validated)` : ''}`
      : `Failed: ${isPermCheck ? 'Required permissions not yet granted' : !toolTypeValid ? `No agent with ${matchedToolType?.[0]} capability found` : 'Agent output validation pending'}`,
    severity,
  };
}

// ============================================================
// Validate Agent Outputs
// ============================================================

function summarizeAgent(agent: ProvisionedAgent): AgentValidationSummary {
  const isHealthy = agent.status === 'running' || agent.status === 'completed';

  return {
    agentId: agent.id,
    role: agent.role,
    status: agent.status,
    outputValid: isHealthy,
    notes: isHealthy
      ? `Agent "${agent.role}" is ${agent.status} with ${agent.capabilities.length} capabilities active`
      : `Agent "${agent.role}" is in ${agent.status} state — output may be incomplete`,
  };
}

// ============================================================
// Main: Run Validation
// ============================================================

/**
 * Execute the validation checklist against all agent outputs.
 * This is the Quality Gate — the final step before HITL approval.
 *
 * Returns a ValidationReport and transitions the mission to
 * 'pending_approval' (if passed) or keeps it in 'pending_validation'.
 */
export async function runValidation(
  mission: Mission,
  tenantId: string,
  agents: ProvisionedAgent[]
): Promise<ValidationReport> {
  const supabase = createServiceClient();

  // Touch heartbeat during validation
  await touchHeartbeat(mission.id);

  // 1. Evaluate each checklist item
  const checklist = mission.validationChecklist.map((assertion, i) =>
    evaluateChecklistItem(assertion, i, agents, mission)
  );

  // 2. Summarize agent states
  const agentSummaries = agents.map(summarizeAgent);

  // 3. Calculate score
  const passedChecks = checklist.filter((c) => c.passed).length;
  const failedChecks = checklist.filter((c) => !c.passed).length;
  const totalChecks = checklist.length;
  const score = totalChecks > 0 ? passedChecks / totalChecks : 0;

  // 4. Determine recommendation
  const criticalFailures = checklist.filter((c) => !c.passed && c.severity === 'critical').length;
  let recommendation: 'approve' | 'review' | 'reject';
  if (criticalFailures > 0) {
    recommendation = 'reject';
  } else if (score >= 0.8) {
    recommendation = 'approve';
  } else {
    recommendation = 'review';
  }

  const passed = recommendation !== 'reject' && score >= 0.6;

  const report: ValidationReport = {
    missionId: mission.id,
    tenantId,
    executedAt: new Date().toISOString(),
    passed,
    score,
    totalChecks,
    passedChecks,
    failedChecks,
    checklist,
    agentSummaries,
    recommendation,
  };

  // 5. Persist validation report
  await supabase
    .from('missions')
    .update({ validation_report: report })
    .eq('id', mission.id)
    .eq('tenant_id', tenantId);

  // 6. Transition mission status based on result
  if (passed) {
    await supabase
      .from('missions')
      .update({ status: 'pending_approval', heartbeat_at: new Date().toISOString() })
      .eq('id', mission.id)
      .eq('tenant_id', tenantId);

    await captureSnapshot(mission.id, tenantId, 'pending_approval');
  } else {
    await supabase
      .from('missions')
      .update({ status: 'pending_validation', heartbeat_at: new Date().toISOString() })
      .eq('id', mission.id)
      .eq('tenant_id', tenantId);

    await captureSnapshot(mission.id, tenantId, 'validation_failed');
  }

  // 7. Create redacted proposed action for HITL queue
  const actionPayload = {
    type: 'validation_complete',
    report: { score, passedChecks, failedChecks, recommendation, checklist },
  };

  const { redactedPayload } = redactPayload(actionPayload);

  // Only create HITL action if validation passed (needs human approval)
  if (passed) {
    const { error: actionErr } = await supabase.from('proposed_actions').insert({
      tenant_id: tenantId,
      mission_id: mission.id,
      agent_id: agents[0]?.id, // Attribute to first agent
      action_type: 'validation_gate',
      description: `Mission "${mission.title}" passed validation (score: ${(score * 100).toFixed(0)}%). ${recommendation === 'approve' ? 'Auto-approval recommended.' : 'Human review required.'}`,
      target: 'HITL Approval Queue',
      payload: actionPayload,
      payload_redacted: redactedPayload,
      risk_level: recommendation === 'approve' ? 'low' : 'medium',
      is_dry_run: false,
      reversible: true,
      status: 'pending',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });

    if (actionErr) {
      console.error('[ValidationAgent] Failed to create HITL action:', actionErr.message);
    }
  }

  // 8. Log event
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: passed ? 'mission.validation_passed' : 'mission.validation_failed',
    entity_type: 'mission',
    entity_id: mission.id,
    payload: { score, passedChecks, failedChecks, recommendation },
  });

  return report;
}
