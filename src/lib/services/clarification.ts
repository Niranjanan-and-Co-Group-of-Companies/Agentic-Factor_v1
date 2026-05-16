import { createServiceClient } from '../supabase/server';
import { redactPayload } from '../middleware/redactor';

// ============================================================
// Clarification Queue — The "Ask-Back" System
//
// When an agent hits a boundary, missing data, or ambiguity,
// it posts a Clarification to this queue. Agent execution
// PAUSES for that node until the human answers.
// All agent→human communications pass through the redactor.
// ============================================================

export interface Clarification {
  id: string;
  tenantId: string;
  missionId: string;
  agentId: string;
  agentRole: string;
  question: string;
  context: string;
  category: 'missing_data' | 'ambiguity' | 'boundary' | 'permission' | 'confirmation';
  priority: 'low' | 'medium' | 'high' | 'blocking';
  status: 'pending' | 'answered' | 'skipped' | 'expired';
  answer: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
  createdAt: string;
  expiresAt: string;
}

/**
 * Agent posts a clarification request. Execution pauses for that node.
 * The question + context are redacted before storage.
 */
export async function postClarification(
  tenantId: string,
  missionId: string,
  agentId: string,
  agentRole: string,
  question: string,
  context: string,
  category: Clarification['category'] = 'missing_data',
  priority: Clarification['priority'] = 'medium'
): Promise<Clarification> {
  const supabase = createServiceClient();

  // Redact context before storing (security mandate)
  const { redactedPayload } = redactPayload({ question, context });

  const clarification: Clarification = {
    id: crypto.randomUUID(),
    tenantId,
    missionId,
    agentId,
    agentRole,
    question: redactedPayload.question as string,
    context: redactedPayload.context as string,
    category,
    priority,
    status: 'pending',
    answer: null,
    answeredAt: null,
    answeredBy: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };

  // Store as event (audit trail + queryable)
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'agent.clarification_requested',
    entity_type: 'agent',
    entity_id: agentId,
    payload: clarification,
  });

  // Pause the agent
  await supabase
    .from('agents')
    .update({ status: 'paused' })
    .eq('id', agentId)
    .eq('tenant_id', tenantId);

  return clarification;
}

/**
 * Human answers a clarification. Agent resumes.
 */
export async function answerClarification(
  tenantId: string,
  clarificationId: string,
  agentId: string,
  answer: string,
  answeredBy: string
): Promise<void> {
  const supabase = createServiceClient();

  // Log the answer
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'agent.clarification_answered',
    entity_type: 'agent',
    entity_id: agentId,
    actor: answeredBy,
    payload: { clarificationId, answer, answeredAt: new Date().toISOString() },
  });

  // Resume the agent
  await supabase
    .from('agents')
    .update({ status: 'running' })
    .eq('id', agentId)
    .eq('tenant_id', tenantId);
}

/**
 * Get all pending clarifications for a tenant.
 */
export async function getPendingClarifications(tenantId: string): Promise<Clarification[]> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('events')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('event_type', 'agent.clarification_requested')
    .order('created_at', { ascending: false });

  if (!data) return [];

  // Filter to only pending ones (not yet answered)
  const clarifications = data.map((e) => e.payload as Clarification);
  const { data: answers } = await supabase
    .from('events')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('event_type', 'agent.clarification_answered');

  const answeredIds = new Set(
    (answers || []).map((a) => (a.payload as { clarificationId: string }).clarificationId)
  );

  return clarifications.filter((c) => !answeredIds.has(c.id));
}
