// Verify which tables exist in Supabase via REST API
// Usage: node verify-tables.mjs

const SUPABASE_URL = 'https://dpwdlfrbadmfhqcborsz.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwd2RsZnJiYWRtZmhxY2JvcnN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODIwNzgxOCwiZXhwIjoyMDkzNzgzODE4fQ.a9dDoRosukhJmpswyOLnzWFYWP1LICdHCUIawTUyHaI';

const tables = ['missions', 'agents', 'permissions', 'proposed_actions', 'events', 'clarifications', 'mission_snapshots'];

async function checkTable(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=0`, {
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  return { table, status: res.status, ok: res.ok, error: res.ok ? null : (await res.json()) };
}

async function run() {
  console.log('📋 Checking Supabase tables...\n');
  for (const table of tables) {
    const result = await checkTable(table);
    if (result.ok) {
      console.log(`  ✅ ${table}: exists`);
    } else {
      console.log(`  ❌ ${table}: ${result.error?.message || `HTTP ${result.status}`}`);
    }
  }
}

run().catch(console.error);
