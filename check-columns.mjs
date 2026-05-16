// Probe mission_snapshots column names by testing inserts
const SUPABASE_URL = 'https://dpwdlfrbadmfhqcborsz.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwd2RsZnJiYWRtZmhxY2JvcnN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODIwNzgxOCwiZXhwIjoyMDkzNzgzODE4fQ.a9dDoRosukhJmpswyOLnzWFYWP1LICdHCUIawTUyHaI';

const candidates = [
  'snapshot_data', 'snapshot', 'data', 'payload',
  'trigger', 'trigger_status',
  'tenant_id', 'mission_id', 'version', 'created_at',
  'id', 'snapshot_index', 'type',
];

async function testColumn(col) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mission_snapshots?select=${col}&limit=0`, {
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  const ok = res.status === 200;
  if (!ok) {
    const body = await res.json();
    return { col, exists: false, error: body.message };
  }
  return { col, exists: true };
}

async function run() {
  console.log('Probing mission_snapshots columns...\n');
  for (const col of candidates) {
    const result = await testColumn(col);
    console.log(`  ${result.exists ? '✅' : '❌'} ${col}${result.error ? ` — ${result.error}` : ''}`);
  }
}

run();
