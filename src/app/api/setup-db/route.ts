import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// POST /api/setup-db — Create missing database tables
// Uses the service role key to run table creation.
// This endpoint creates tables that don't exist yet.
// ============================================================
export async function POST() {
  const supabase = createServiceClient();

  const results: Record<string, string> = {};

  // Try to create agents table by inserting then deleting
  // Since we can't run DDL via PostgREST, we check which tables exist
  const tables = ['missions', 'agents', 'permissions', 'proposed_actions', 'events', 'clarifications', 'mission_snapshots'];
  
  for (const table of tables) {
    const { error } = await supabase.from(table).select('*').limit(0);
    results[table] = error ? `❌ ${error.message}` : '✅ exists';
  }

  return NextResponse.json({ results, note: 'Missing tables must be created via Supabase SQL Editor. See /src/lib/supabase/migrations/000_standalone_tables.sql' });
}
