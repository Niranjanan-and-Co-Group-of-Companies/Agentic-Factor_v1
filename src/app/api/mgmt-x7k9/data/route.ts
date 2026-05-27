import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/admin/data?view=dashboard|connectors|tenants|missions
// Returns admin panel data. Protected by admin session.
// ============================================================

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get('admin_session');
  return !!session?.value;
}

export async function GET(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const view = request.nextUrl.searchParams.get('view') || 'dashboard';
  const supabase = createServiceClient();

  switch (view) {
    case 'dashboard': {
      // Get overview stats
      const [
        { count: totalTenants },
        { count: activeMissions },
        { count: totalMissions },
        { data: recentEvents },
        { data: billingStats },
      ] = await Promise.all([
        supabase.from('tenant_billing').select('id', { count: 'exact', head: true }),
        supabase.from('missions').select('id', { count: 'exact', head: true }).in('status', ['active', 'building']),
        supabase.from('missions').select('id', { count: 'exact', head: true }),
        supabase.from('events').select('event_type, created_at, tenant_id').order('created_at', { ascending: false }).limit(20),
        supabase.from('tenant_billing').select('plan, credits_used_this_month'),
      ]);

      // Calculate revenue distribution
      const planCounts: Record<string, number> = {};
      const totalCreditsUsed = (billingStats || []).reduce((sum: number, b: any) => {
        planCounts[b.plan] = (planCounts[b.plan] || 0) + 1;
        return sum + (b.credits_used_this_month || 0);
      }, 0);

      return NextResponse.json({
        totalTenants: totalTenants || 0,
        activeMissions: activeMissions || 0,
        totalMissions: totalMissions || 0,
        totalCreditsUsed,
        planDistribution: planCounts,
        recentEvents: recentEvents || [],
      });
    }

    case 'connectors': {
      // Get connector requests from events table
      const { data } = await supabase
        .from('events')
        .select('id, tenant_id, payload, created_at')
        .eq('event_type', 'connector.requested')
        .order('created_at', { ascending: false })
        .limit(50);

      return NextResponse.json({ requests: data || [] });
    }

    case 'tenants': {
      const { data } = await supabase
        .from('tenant_billing')
        .select('tenant_id, plan, credits_remaining, credits_total, credits_used_this_month, max_active_missions, model_tier, billing_status, is_trial, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(100);

      return NextResponse.json({ tenants: data || [] });
    }

    case 'missions': {
      const { data } = await supabase
        .from('missions')
        .select('id, tenant_id, status, created_at, updated_at, mission_json')
        .order('updated_at', { ascending: false })
        .limit(50);

      // Slim down mission_json for the list view
      const missions = (data || []).map((m: any) => ({
        id: m.id,
        tenantId: m.tenant_id,
        status: m.status,
        title: m.mission_json?.title || 'Untitled',
        agentCount: m.mission_json?.agents?.length || 0,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
      }));

      return NextResponse.json({ missions });
    }

    case 'models': {
      // Get LLM models from registry
      const { data } = await supabase
        .from('llm_models')
        .select('id, provider, model_name, display_name, tier, priority, is_active, health_status, failure_count, last_health_check')
        .order('tier', { ascending: true })
        .order('priority', { ascending: true });

      return NextResponse.json({ models: data || [] });
    }

    case 'connector_defs': {
      // Get connector definitions from DB
      const { data } = await supabase
        .from('connector_definitions')
        .select('id, label, description, category, status, provider, is_active, sort_order')
        .order('sort_order', { ascending: true });

      return NextResponse.json({ connectors: data || [] });
    }

    default:
      return NextResponse.json({ error: 'Invalid view' }, { status: 400 });
  }
}

// POST — Admin actions (mark connector configured, manual plan override, etc.)
export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { action, ...params } = await request.json();
  const supabase = createServiceClient();

  switch (action) {
    case 'mark_connector_configured': {
      // Update event payload to mark as configured
      const { eventId, connectorId } = params;
      await supabase
        .from('events')
        .update({ payload: { ...params, status: 'configured', configuredAt: new Date().toISOString() } })
        .eq('id', eventId);

      // Notify requesting user
      const { data: event } = await supabase.from('events').select('payload').eq('id', eventId).single();
      if (event?.payload?.userEmail) {
        const { sendEmail } = await import('@/lib/services/notifications');
        await sendEmail({
          to: event.payload.userEmail,
          subject: `✅ ${connectorId} connector is now available!`,
          body: `Great news! The ${connectorId} connector you requested is now ready.\n\nConnect it from your dashboard: https://agenticfactor.io/connectors`,
        });
      }

      return NextResponse.json({ success: true });
    }

    case 'override_plan': {
      const { tenantId, plan, credits } = params;
      const planConfigs: Record<string, any> = {
        free:       { maxActiveMissions: 1,     modelTier: 'flash',  maxStorageMb: 100,       governance: 'none' },
        individual: { maxActiveMissions: 5,     modelTier: 'mixed',  maxStorageMb: 10_240,    governance: 'basic_memory' },
        pro:        { maxActiveMissions: 50,    modelTier: 'all',    maxStorageMb: 102_400,   governance: 'rbac' },
        enterprise: { maxActiveMissions: 99999, modelTier: 'custom', maxStorageMb: 1_048_576, governance: 'full_audit' },
      };

      const config = planConfigs[plan] || planConfigs['free'];
      await supabase
        .from('tenant_billing')
        .update({
          plan,
          credits_remaining: credits || config.maxActiveMissions,
          credits_total: credits || 99999,
          max_active_missions: config.maxActiveMissions,
          model_tier: config.modelTier,
          max_storage_mb: config.maxStorageMb,
          governance: config.governance,
          billing_status: 'active',
          is_trial: false,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId);

      return NextResponse.json({ success: true });
    }

    case 'toggle_model': {
      const { modelId, isActive } = params;
      await supabase
        .from('llm_models')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', modelId);
      return NextResponse.json({ success: true });
    }

    case 'toggle_connector': {
      const { connectorId, isActive: connActive } = params;
      await supabase
        .from('connector_definitions')
        .update({ is_active: connActive, updated_at: new Date().toISOString() })
        .eq('id', connectorId);
      return NextResponse.json({ success: true });
    }

    case 'add_model': {
      const { provider, model_name, display_name, tier, priority } = params;
      if (!provider || !model_name || !display_name) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }
      const { error: insertErr } = await supabase.from('llm_models').insert({
        provider,
        model_name,
        display_name,
        tier: tier || 2,
        priority: priority || 1,
        is_active: true,
        health_status: 'healthy',
      });
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    case 'add_connector': {
      const { id: connId, label: connLabel, description: connDesc, category: connCat, status: connStatus, provider: connProvider } = params;
      if (!connId || !connLabel) {
        return NextResponse.json({ error: 'Missing required fields (id, label)' }, { status: 400 });
      }
      const { error: connInsertErr } = await supabase.from('connector_definitions').insert({
        id: connId,
        label: connLabel,
        description: connDesc || '',
        category: connCat || 'productivity',
        status: connStatus || 'request_access',
        provider: connProvider || null,
        is_active: true,
        sort_order: 100,
      });
      if (connInsertErr) return NextResponse.json({ error: connInsertErr.message }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}
