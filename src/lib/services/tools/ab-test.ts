import { ToolExecutionContext, registerTool } from './index';
import { createServiceClient } from '@/lib/supabase/server';

// A/B testing for outreach emails — stored in the events table under event_type 'ab_test.*'
// Workflow:
//   1. create_ab_test — define variants (e.g., two subject lines)
//   2. pick_ab_variant — pick which variant to use for this prospect (round-robin)
//   3. record_ab_result — record reply/click/open outcome
//   4. get_ab_results — summarise winner

async function createAbTestTool({ tenantId, missionId, args }: ToolExecutionContext) {
  const { test_name, variants } = args as { test_name: string; variants: string[] };
  if (!test_name || !variants?.length || variants.length < 2) {
    return { error: 'Provide test_name and at least 2 variants' };
  }
  const supabase = createServiceClient();
  const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'ab_test.created',
    entity_type: 'mission',
    entity_id: missionId,
    payload: { test_id: testId, test_name, variants, created_at: new Date().toISOString() },
  });
  return { test_id: testId, test_name, variants };
}

async function pickAbVariantTool({ tenantId, missionId, args }: ToolExecutionContext) {
  const { test_id, prospect_identifier } = args as { test_id: string; prospect_identifier: string };
  if (!test_id || !prospect_identifier) return { error: 'Missing required arguments: test_id, prospect_identifier' };

  const supabase = createServiceClient();

  // Get the test definition
  const { data: testEvents } = await supabase
    .from('events')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('event_type', 'ab_test.created')
    .eq('entity_id', missionId)
    .order('created_at', { ascending: false })
    .limit(10);

  const test = (testEvents ?? []).find(e => (e.payload as Record<string, unknown>).test_id === test_id);
  if (!test) return { error: `Test ${test_id} not found` };
  const variants = (test.payload as Record<string, string[]>).variants;

  // Count how many times each variant has been picked so far (round-robin)
  const { data: picks } = await supabase
    .from('events')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('event_type', 'ab_test.picked')
    .eq('entity_id', missionId);

  const counts: Record<string, number> = {};
  variants.forEach(v => (counts[v] = 0));
  for (const p of picks ?? []) {
    const v = (p.payload as Record<string, string>).variant;
    if (v && counts[v] !== undefined) counts[v]++;
  }

  // Pick the variant with fewest picks (ties broken by index)
  const picked = variants.reduce((a, b) => (counts[a] <= counts[b] ? a : b));

  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'ab_test.picked',
    entity_type: 'mission',
    entity_id: missionId,
    payload: { test_id, variant: picked, prospect: prospect_identifier },
  });

  return { test_id, variant: picked, prospect: prospect_identifier };
}

async function recordAbResultTool({ tenantId, missionId, args }: ToolExecutionContext) {
  const { test_id, variant, prospect_identifier, outcome } = args as {
    test_id: string; variant: string; prospect_identifier: string; outcome: 'replied' | 'opened' | 'clicked' | 'ignored' | 'bounced';
  };
  if (!test_id || !variant || !outcome) return { error: 'Missing required arguments: test_id, variant, outcome' };
  const supabase = createServiceClient();
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'ab_test.result',
    entity_type: 'mission',
    entity_id: missionId,
    payload: { test_id, variant, prospect: prospect_identifier, outcome, recorded_at: new Date().toISOString() },
  });
  return { success: true, test_id, variant, outcome };
}

async function getAbResultsTool({ tenantId, missionId, args }: ToolExecutionContext) {
  const { test_id } = args as { test_id: string };
  if (!test_id) return { error: 'Missing required argument: test_id' };

  const supabase = createServiceClient();
  const { data: results } = await supabase
    .from('events')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('event_type', 'ab_test.result')
    .eq('entity_id', missionId);

  const testResults = (results ?? []).filter(r => (r.payload as Record<string, string>).test_id === test_id);
  const stats: Record<string, { total: number; replied: number; reply_rate: number }> = {};
  for (const r of testResults) {
    const { variant, outcome } = r.payload as Record<string, string>;
    if (!stats[variant]) stats[variant] = { total: 0, replied: 0, reply_rate: 0 };
    stats[variant].total++;
    if (outcome === 'replied') stats[variant].replied++;
  }
  for (const v of Object.keys(stats)) {
    stats[v].reply_rate = stats[v].total > 0 ? Math.round((stats[v].replied / stats[v].total) * 100) : 0;
  }
  const winner = Object.entries(stats).sort((a, b) => b[1].reply_rate - a[1].reply_rate)[0]?.[0] ?? null;
  return { test_id, stats, winner, total_results: testResults.length };
}

registerTool('create_ab_test', createAbTestTool);
registerTool('pick_ab_variant', pickAbVariantTool);
registerTool('record_ab_result', recordAbResultTool);
registerTool('get_ab_results', getAbResultsTool);
