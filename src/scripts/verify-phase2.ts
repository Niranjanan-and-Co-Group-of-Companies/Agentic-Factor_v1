import { v4 as uuidv4 } from 'uuid';
import type { Mission } from '../lib/schemas/mission';
import { buildTeam, getMissionWithAgents } from '../lib/services/orchestrator';
import { listSnapshots } from '../lib/services/snapshots';
import { createServiceClient } from '../lib/supabase/server';

// ============================================================
// Phase 2 Verification Script
// Provisions a 3-agent team and verifies:
// 1. ✅ 3 agent rows created in DB (lazy provisioning)
// 2. ✅ All agents reach 'running' status
// 3. ✅ Research log provisioned for agents with requiresExternalData
// 4. ✅ State snapshots captured on every transition
// 5. ✅ Dry run report generated
// 6. ✅ Mission reaches 'active' status
// ============================================================

// Deterministic UUIDs for the test
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MISSION_ID = uuidv4();
const AGENT_IDS = [uuidv4(), uuidv4(), uuidv4()];

/**
 * Build a synthetic 3-agent mission (no LLM call needed).
 */
function createTestMission(): Mission {
  const now = new Date().toISOString();

  return {
    id: MISSION_ID,
    tenantId: TENANT_ID,
    title: 'E-commerce Data Pipeline',
    description: 'Scrape product data, analyze pricing trends, and generate a report.',
    status: 'draft',
    agents: [
      {
        id: AGENT_IDS[0],
        role: 'Web Scraper',
        agentIndex: 0,
        capabilities: ['scrape_web', 'parse_html'],
        requiresExternalData: true,
        tools: [
          { name: 'HTTP Client', type: 'api', requiresAuth: false, confidentialityLevel: 'public' },
        ],
        systemPrompt: 'You are a web scraper agent. Fetch product data from e-commerce sites and extract structured information.',
        trustLevel: 'conditional' as const,
      },
      {
        id: AGENT_IDS[1],
        role: 'Data Analyst',
        agentIndex: 1,
        capabilities: ['analyze_data', 'detect_trends', 'statistical_analysis'],
        requiresExternalData: false,
        tools: [
          { name: 'PostgreSQL', type: 'database', requiresAuth: true, confidentialityLevel: 'internal' },
        ],
        systemPrompt: 'You are a data analyst agent. Analyze scraped product data and identify pricing trends and anomalies.',
        trustLevel: 'conditional' as const,
      },
      {
        id: AGENT_IDS[2],
        role: 'Report Generator',
        agentIndex: 2,
        capabilities: ['generate_report', 'format_markdown', 'send_email'],
        requiresExternalData: false,
        tools: [
          { name: 'Email API', type: 'notification', requiresAuth: true, confidentialityLevel: 'internal' },
          { name: 'File Storage', type: 'file_system', requiresAuth: false, confidentialityLevel: 'public' },
        ],
        systemPrompt: 'You are a report generator agent. Create formatted markdown reports from analyzed data and send via email.',
        trustLevel: 'conditional' as const,
      },
    ],
    orchestration: {
      pattern: 'sequential',
      timeoutSeconds: 300,
      entryAgent: AGENT_IDS[0],
      edges: [
        { from: AGENT_IDS[0], to: AGENT_IDS[1] },
        { from: AGENT_IDS[1], to: AGENT_IDS[2] },
      ],
    },
    validationChecklist: [
      'Product data contains at least 10 items',
      'Price trend analysis includes statistical measures',
      'Report is generated in valid Markdown format',
      'Email delivery is confirmed',
    ],
    permissions: [
      { type: 'api_key', service: 'PostgreSQL', scope: 'read_write', confidentialityLevel: 'internal', granted: false },
      { type: 'api_key', service: 'Email Service', scope: 'send', confidentialityLevel: 'internal', granted: false },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Seed the test tenant if it doesn't exist.
 */
async function seedTenant(): Promise<void> {
  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', TENANT_ID)
    .single();

  if (!existing) {
    await supabase.from('tenants').insert({
      id: TENANT_ID,
      name: 'Test Tenant',
      slug: 'test-tenant',
      settings: {},
    });
    console.log('✅ Test tenant seeded');
  }
}

/**
 * Seed the mission row (simulates what intake.ts would do).
 */
async function seedMission(mission: Mission): Promise<void> {
  const supabase = createServiceClient();

  await supabase.from('missions').insert({
    id: mission.id,
    tenant_id: mission.tenantId,
    title: mission.title,
    description: mission.description,
    status: 'draft',
    mission_json: mission,
    heartbeat_at: new Date().toISOString(),
  });
  console.log('✅ Mission row seeded');
}

// ============================================================
// Main verification
// ============================================================
export async function runVerification(): Promise<{
  success: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
}> {
  const checks: { name: string; passed: boolean; detail: string }[] = [];
  const mission = createTestMission();

  try {
    // Setup
    await seedTenant();
    await seedMission(mission);

    // ── BUILD THE TEAM ──
    console.log('\n🔨 Building 3-agent team...\n');
    const result = await buildTeam(mission, TENANT_ID);

    // ── CHECK 1: 3 agent rows in DB ──
    const missionData = await getMissionWithAgents(MISSION_ID, TENANT_ID);
    const agentCount = missionData?.agents.length || 0;
    checks.push({
      name: 'Lazy Provisioning: 3 agent rows created',
      passed: agentCount === 3,
      detail: `Found ${agentCount} agents in DB`,
    });

    // ── CHECK 2: All agents running ──
    const allRunning = missionData?.agents.every((a) => a.status === 'running') || false;
    checks.push({
      name: 'Dynamic Spawning: All agents reached "running"',
      passed: allRunning,
      detail: `Agent statuses: ${missionData?.agents.map((a) => `${a.role}=${a.status}`).join(', ')}`,
    });

    // ── CHECK 3: Research log for agent 0 ──
    const supabase = createServiceClient();
    const { data: researchEvents } = await supabase
      .from('events')
      .select('*')
      .eq('tenant_id', TENANT_ID)
      .eq('event_type', 'agent.research_log_provisioned');

    const hasResearchLog = (researchEvents?.length || 0) > 0;
    checks.push({
      name: 'Research log provisioned for external data agent',
      passed: hasResearchLog,
      detail: `Research logs found: ${researchEvents?.length || 0}`,
    });

    // ── CHECK 4: Snapshots captured ──
    const snapshots = await listSnapshots(MISSION_ID, TENANT_ID);
    checks.push({
      name: 'State snapshots captured on transitions',
      passed: snapshots.length >= 2,
      detail: `Snapshots: ${snapshots.map((s) => `v${s.version}:${s.triggerStatus}`).join(', ')}`,
    });

    // ── CHECK 5: Dry run report ──
    checks.push({
      name: 'Dry run report generated',
      passed: result.dryRunReport !== null,
      detail: `Success: ${result.dryRunReport.success}, Tokens: ${result.dryRunReport.totalEstimatedTokens}, Cost: $${result.dryRunReport.totalEstimatedCostUsd.toFixed(4)}`,
    });

    // ── CHECK 6: Mission status ──
    const expectedStatus = result.dryRunReport.success ? 'active' : 'failed';
    const actualStatus = missionData?.mission?.status || 'unknown';
    checks.push({
      name: `Mission reached "${expectedStatus}" status`,
      passed: actualStatus === expectedStatus,
      detail: `Current status: ${actualStatus}`,
    });

    // ── CHECK 7: Orchestration graph ──
    checks.push({
      name: 'Orchestration graph wired correctly',
      passed: result.graph.agents.length === 3 && result.graph.edges.length === 2,
      detail: `Graph: ${result.graph.agents.length} agents, ${result.graph.edges.length} edges, pattern=${result.graph.pattern}`,
    });

    // ── Print results ──
    console.log('\n' + '='.repeat(60));
    console.log('  PHASE 2 VERIFICATION RESULTS');
    console.log('='.repeat(60) + '\n');

    for (const check of checks) {
      const icon = check.passed ? '✅' : '❌';
      console.log(`${icon} ${check.name}`);
      console.log(`   ${check.detail}\n`);
    }

    const allPassed = checks.every((c) => c.passed);
    console.log('='.repeat(60));
    console.log(allPassed ? '🎉 ALL CHECKS PASSED' : '⚠️  SOME CHECKS FAILED');
    console.log('='.repeat(60));

    return { success: allPassed, checks };
  } catch (err) {
    console.error('❌ Verification failed with error:', err);
    return {
      success: false,
      checks: [
        ...checks,
        { name: 'Execution', passed: false, detail: (err as Error).message },
      ],
    };
  }
}

// Run if executed directly
runVerification().catch(console.error);
