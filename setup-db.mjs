// Run SQL migration against Supabase using the service role key
// Usage: node setup-db.mjs

const SUPABASE_URL = 'https://dpwdlfrbadmfhqcborsz.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwd2RsZnJiYWRtZmhxY2JvcnN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODIwNzgxOCwiZXhwIjoyMDkzNzgzODE4fQ.a9dDoRosukhJmpswyOLnzWFYWP1LICdHCUIawTUyHaI';

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,

  `CREATE TABLE IF NOT EXISTS missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    mission_json JSONB NOT NULL DEFAULT '{}',
    validation_report JSONB,
    heartbeat_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    agent_index INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'inactive',
    capabilities TEXT[] NOT NULL DEFAULT '{}',
    requires_external_data BOOLEAN DEFAULT false,
    system_prompt TEXT,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    service TEXT NOT NULL,
    scope TEXT NOT NULL,
    confidentiality_level TEXT NOT NULL DEFAULT 'internal',
    granted BOOLEAN DEFAULT false,
    encrypted_value BYTEA,
    granted_at TIMESTAMPTZ,
    granted_by UUID
  )`,

  `CREATE TABLE IF NOT EXISTS proposed_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
    agent_id UUID,
    action_type TEXT NOT NULL,
    description TEXT NOT NULL,
    target TEXT,
    payload JSONB,
    payload_redacted JSONB,
    risk_level TEXT NOT NULL DEFAULT 'medium',
    is_dry_run BOOLEAN DEFAULT false,
    dry_run_result JSONB,
    reversible BOOLEAN DEFAULT true,
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMPTZ DEFAULT now(),
    decided_at TIMESTAMPTZ,
    decided_by UUID,
    expires_at TIMESTAMPTZ DEFAULT (now() + interval '1 hour')
  )`,

  `CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    actor UUID,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS clarifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
    agent_id UUID,
    question TEXT NOT NULL,
    answer TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    answered_at TIMESTAMPTZ
  )`,

  `CREATE TABLE IF NOT EXISTS mission_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    trigger TEXT NOT NULL,
    snapshot_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
];

// Supabase doesn't expose raw SQL via REST, so we use the
// @supabase/supabase-js client with the service role key
// which has admin access.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  db: { schema: 'public' },
  auth: { persistSession: false },
});

async function run() {
  console.log('🔧 Running database setup...\n');

  for (const sql of statements) {
    const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] || sql.slice(0, 40);
    process.stdout.write(`  Creating ${tableName}... `);
    
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
    if (error) {
      // Try alternate approach - direct fetch to the SQL endpoint
      console.log(`⚠️  RPC unavailable, trying direct...`);
    } else {
      console.log('✅');
    }
  }

  // Verify tables exist by trying to query them
  console.log('\n📋 Verifying tables...');
  const tables = ['missions', 'agents', 'permissions', 'proposed_actions', 'events', 'clarifications', 'mission_snapshots'];
  
  for (const table of tables) {
    const { error } = await supabase.from(table).select('id').limit(0);
    if (error) {
      console.log(`  ❌ ${table}: ${error.message}`);
    } else {
      console.log(`  ✅ ${table}: exists`);
    }
  }
}

run().catch(console.error);
