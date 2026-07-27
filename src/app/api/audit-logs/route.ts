import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/audit-logs
// Returns tenant event log with filtering and pagination.
// Query params:
//   event_type — filter by event type prefix (e.g. "billing" or "mission.run")
//   entity_type — filter by entity type (mission, agent, billing)
//   entity_id  — filter by specific entity
//   from       — ISO date lower bound
//   to         — ISO date upper bound
//   limit      — max records (default 50, max 200)
//   offset     — for pagination
// ============================================================

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const params = request.nextUrl.searchParams;
  const event_type = params.get('event_type');
  const entity_type = params.get('entity_type');
  const entity_id = params.get('entity_id');
  const from = params.get('from');
  const to = params.get('to');
  const limit = Math.min(parseInt(params.get('limit') ?? '50', 10), 200);
  const offset = parseInt(params.get('offset') ?? '0', 10);

  const supabase = createServiceClient();

  let query = supabase
    .from('events')
    .select('id, event_type, entity_type, entity_id, payload, created_at', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (event_type) query = query.ilike('event_type', `${event_type}%`);
  if (entity_type) query = query.eq('entity_type', entity_type);
  if (entity_id) query = query.eq('entity_id', entity_id);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data: events, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich event payloads with mission titles for display
  const missionIds = [...new Set((events ?? [])
    .filter(e => e.entity_type === 'mission')
    .map(e => e.entity_id))];

  const titleMap: Record<string, string> = {};
  if (missionIds.length > 0) {
    const { data: missions } = await supabase
      .from('missions')
      .select('id, title')
      .in('id', missionIds);
    for (const m of missions ?? []) titleMap[m.id] = m.title;
  }

  const enriched = (events ?? []).map(e => ({
    ...e,
    entity_title: e.entity_type === 'mission' ? (titleMap[e.entity_id] ?? null) : null,
  }));

  return NextResponse.json({ events: enriched, total: count ?? 0, limit, offset });
}
