import { v4 as uuidv4 } from 'uuid';
import type { Mission } from '../lib/schemas/mission';
import { buildTeam, getMissionAgents } from '../lib/services/orchestrator';
import { executeResearch } from '../lib/services/research';
import { runValidation } from '../lib/services/validation-agent';
import { redactPayload, redactForHITL } from '../lib/middleware/redactor';
import { checkCircuit, recordUsage, getCircuitStatus, resetCircuit, resetMissionTokens } from '../lib/middleware/circuit-breaker';
import { listSnapshots } from '../lib/services/snapshots';
import { createServiceClient } from '../lib/supabase/server';

// ============================================================
// Phase 3 — End-to-End Verification
// Tests: Research → Redactor → Circuit Breaker → Validation Agent
// Using the 'Scraper → Analyst → Reporter' 3-agent team
// ============================================================

const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const MISSION_ID = uuidv4();
const AGENT_IDS = [uuidv4(), uuidv4(), uuidv4()];

function createTestMission(): Mission {
  const now = new Date().toISOString();
  return {
    id: MISSION_ID,
    tenantId: TENANT_ID,
    title: 'E-commerce Price Intelligence Pipeline',
    description: 'Scrape competitor pricing, analyze trends, generate executive report with email delivery.',
    status: 'draft',
    agents: [
      {
        id: AGENT_IDS[0], role: 'Web Scraper', agentIndex: 0,
        capabilities: ['scrape_web', 'parse_html', 'extract_pricing'],
        requiresExternalData: true,
        tools: [{ name: 'HTTP Client', type: 'api' as const, requiresAuth: false, confidentialityLevel: 'public' as const }],
        systemPrompt: 'You are a web scraper. Fetch product pricing data from competitor e-commerce sites using ethical scraping practices.',
        trustLevel: 'conditional' as const,
      },
      {
        id: AGENT_IDS[1], role: 'Data Analyst', agentIndex: 1,
        capabilities: ['analyze_data', 'statistical_analysis', 'trend_detection'],
        requiresExternalData: false,
        tools: [{ name: 'PostgreSQL', type: 'database' as const, requiresAuth: true, confidentialityLevel: 'internal' as const }],
        systemPrompt: 'You are a data analyst. Process scraped pricing data, run statistical analysis, and identify market trends.',
        trustLevel: 'conditional' as const,
      },
      {
        id: AGENT_IDS[2], role: 'Report Generator', agentIndex: 2,
        capabilities: ['generate_report', 'format_markdown', 'send_email'],
        requiresExternalData: false,
        tools: [
          { name: 'SendGrid', type: 'notification' as const, requiresAuth: true, confidentialityLevel: 'internal' as const },
          { name: 'S3 Storage', type: 'file_system' as const, requiresAuth: true, confidentialityLevel: 'confidential' as const },
        ],
        systemPrompt: 'You generate executive reports in markdown and send via email. Include charts and actionable insights.',
        trustLevel: 'conditional' as const,
      },
    ],
    orchestration: {
      pattern: 'sequential', timeoutSeconds: 300, entryAgent: AGENT_IDS[0],
      edges: [{ from: AGENT_IDS[0], to: AGENT_IDS[1] }, { from: AGENT_IDS[1], to: AGENT_IDS[2] }],
    },
    validationChecklist: [
      'Product data contains at least 10 items with valid prices',
      'Statistical analysis includes mean, median, and trend direction',
      'Report is generated in valid Markdown format',
      'Email delivery confirmation is received',
    ],
    permissions: [
      { type: 'api_key', service: 'PostgreSQL', scope: 'read_write', confidentialityLevel: 'internal' as const, granted: true },
      { type: 'api_key', service: 'SendGrid', scope: 'send', confidentialityLevel: 'internal' as const, granted: true },
      { type: 'api_key', service: 'AWS S3', scope: 'read_write', confidentialityLevel: 'confidential' as const, granted: true },
    ],
    createdAt: now, updatedAt: now,
  };
}

type Check = { name: string; passed: boolean; detail: string };

export async function runPhase3Verification(): Promise<{ success: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  const mission = createTestMission();
  const supabase = createServiceClient();

  try {
    // ── Setup ──
    await supabase.from('tenants').upsert({ id: TENANT_ID, name: 'Phase3 Test Tenant', slug: 'phase3-test', settings: {} });
    await supabase.from('missions').insert({
      id: mission.id, tenant_id: TENANT_ID, title: mission.title, description: mission.description,
      status: 'draft', mission_json: mission, heartbeat_at: new Date().toISOString(),
    });
    resetCircuit(TENANT_ID);
    resetMissionTokens(MISSION_ID);

    // ═══════════════════════════════════════════
    // TEST 1: Research Service
    // ═══════════════════════════════════════════
    console.log('\n🔍 Testing Research Service...');
    const researchReport = await executeResearch(
      AGENT_IDS[0], MISSION_ID, TENANT_ID,
      'e-commerce pricing trends web scraping best practices'
    );
    checks.push({
      name: 'Research: Returns sources with confidence',
      passed: researchReport.sources.length > 0 && researchReport.confidence > 0,
      detail: `Sources: ${researchReport.sources.length}, Confidence: ${researchReport.confidence.toFixed(2)}, Flagged: ${researchReport.flaggedForReview}`,
    });
    checks.push({
      name: 'Research: Fact-checked across multiple sources',
      passed: researchReport.factChecked === true,
      detail: `Fact-checked: ${researchReport.factChecked} (${researchReport.sources.length} sources)`,
    });

    // ═══════════════════════════════════════════
    // TEST 2: Confidentiality Redactor
    // ═══════════════════════════════════════════
    console.log('🔒 Testing Confidentiality Redactor...');
    const sensitivePayload = {
      action: 'send_email',
      to: 'john.doe@acme.com',
      apiKey: 'sk-1234567890abcdef1234567890abcdef',
      dbConnection: 'postgres://admin:supersecret@db.example.com:5432/prod',
      body: 'Report for SSN 123-45-6789, card 4111-1111-1111-1111',
    };
    const redacted = redactPayload(sensitivePayload);
    checks.push({
      name: 'Redactor: Masks PII, API keys, and credentials',
      passed: redacted.redactionCount >= 3,
      detail: `Redacted ${redacted.redactionCount} values: ${redacted.redactedFields.join('; ')}`,
    });
    const escalated = redactForHITL(sensitivePayload, 'confidential');
    checks.push({
      name: 'Redactor: Full payload redaction at confidential level',
      passed: (escalated.redactedPayload as Record<string, unknown>)._redacted === true,
      detail: `Level: confidential, Keys preserved: ${(escalated.redactedPayload as Record<string, unknown>)._keys}`,
    });

    // ═══════════════════════════════════════════
    // TEST 3: Token Circuit Breaker
    // ═══════════════════════════════════════════
    console.log('⚡ Testing Token Circuit Breaker...');
    const check1 = checkCircuit(TENANT_ID, MISSION_ID, 1000);
    checks.push({
      name: 'Circuit Breaker: CLOSED state allows calls',
      passed: check1.allowed && check1.state === 'CLOSED',
      detail: `State: ${check1.state}, Allowed: ${check1.allowed}`,
    });

    // Record usage and verify tracking
    await recordUsage(TENANT_ID, MISSION_ID, 5000, 'intake_llm');
    const status = getCircuitStatus(TENANT_ID);
    checks.push({
      name: 'Circuit Breaker: Tracks token usage correctly',
      passed: status.tokensThisMinute === 5000 && status.totalTokensToday === 5000,
      detail: `Minute: ${status.tokensThisMinute}, Day: ${status.totalTokensToday}, Cost: $${status.estimatedDailyCost.toFixed(4)}`,
    });

    // Trip the breaker with excessive tokens
    const overBudget = checkCircuit(TENANT_ID, MISSION_ID, 600_000);
    checks.push({
      name: 'Circuit Breaker: Blocks when mission budget exceeded',
      passed: !overBudget.allowed,
      detail: `Allowed: ${overBudget.allowed}, Reason: ${overBudget.reason}`,
    });

    // ═══════════════════════════════════════════
    // TEST 4: Build team + Validation Agent
    // ═══════════════════════════════════════════
    console.log('🔨 Building team + running Validation Agent...');
    resetCircuit(TENANT_ID);
    resetMissionTokens(MISSION_ID);

    const buildResult = await buildTeam(mission, TENANT_ID);
    checks.push({
      name: 'Orchestrator: 3-agent team built successfully',
      passed: buildResult.graph.agents.length === 3 && buildResult.dryRunReport.success,
      detail: `Agents: ${buildResult.graph.agents.length}, DryRun: ${buildResult.dryRunReport.success}`,
    });

    // Run validation agent
    const agents = await getMissionAgents(MISSION_ID, TENANT_ID);
    const validationReport = await runValidation(mission, TENANT_ID, agents);
    checks.push({
      name: 'Validation Agent: Runs checklist and produces report',
      passed: validationReport.totalChecks === 4 && validationReport.score > 0,
      detail: `Score: ${(validationReport.score * 100).toFixed(0)}%, Passed: ${validationReport.passedChecks}/${validationReport.totalChecks}, Recommendation: ${validationReport.recommendation}`,
    });

    // Check mission reached pending_approval or pending_validation
    const { data: finalMission } = await supabase.from('missions').select('status').eq('id', MISSION_ID).single();
    const validStatuses = ['pending_approval', 'pending_validation'];
    checks.push({
      name: 'Validation Agent: Mission transitioned correctly',
      passed: validStatuses.includes(finalMission?.status || ''),
      detail: `Final status: ${finalMission?.status}`,
    });

    // Check HITL action was created (if validation passed)
    const { data: hitlActions } = await supabase.from('proposed_actions').select('*').eq('mission_id', MISSION_ID).eq('action_type', 'validation_gate');
    if (validationReport.passed) {
      checks.push({
        name: 'Validation Agent: Created redacted HITL action',
        passed: (hitlActions?.length || 0) > 0,
        detail: `HITL actions created: ${hitlActions?.length || 0}`,
      });
    }

    // Verify snapshots were captured through the entire flow
    const snapshots = await listSnapshots(MISSION_ID, TENANT_ID);
    checks.push({
      name: 'State Versioning: Snapshots captured across full flow',
      passed: snapshots.length >= 3,
      detail: `Snapshots: ${snapshots.map((s) => `v${s.version}:${s.triggerStatus}`).join(', ')}`,
    });

    // ── Print Results ──
    console.log('\n' + '='.repeat(65));
    console.log('  PHASE 3 — TOOLBELT & SAFETY — VERIFICATION RESULTS');
    console.log('='.repeat(65) + '\n');
    for (const c of checks) {
      console.log(`${c.passed ? '✅' : '❌'} ${c.name}`);
      console.log(`   ${c.detail}\n`);
    }
    const allPassed = checks.every((c) => c.passed);
    console.log('='.repeat(65));
    console.log(allPassed ? '🎉 ALL PHASE 3 CHECKS PASSED' : '⚠️  SOME CHECKS FAILED');
    console.log('='.repeat(65));

    return { success: allPassed, checks };
  } catch (err) {
    console.error('❌ Phase 3 verification failed:', err);
    return { success: false, checks: [...checks, { name: 'Execution', passed: false, detail: (err as Error).message }] };
  }
}

runPhase3Verification().catch(console.error);
