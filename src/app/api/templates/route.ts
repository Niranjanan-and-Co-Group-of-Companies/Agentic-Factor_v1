import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/templates — list all mission templates
// POST /api/templates/:slug/fork — fork a template into a new mission
// ============================================================

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const category = params.get('category');
  const featured = params.get('featured');

  const supabase = createServiceClient();

  let query = supabase
    .from('mission_templates')
    .select('id, slug, title, description, category, icon, tags, is_featured, use_count')
    .order('is_featured', { ascending: false })
    .order('use_count', { ascending: false });

  if (category) query = query.eq('category', category);
  if (featured === 'true') query = query.eq('is_featured', true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ templates: data ?? [] });
}

// POST /api/templates — fork a template (slug in body) into a new mission
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { slug } = await request.json() as { slug: string };
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const supabase = createServiceClient();

  const { data: template, error: tErr } = await supabase
    .from('mission_templates')
    .select('*')
    .eq('slug', slug)
    .single();

  if (tErr || !template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const missionJson = template.mission_json as Record<string, unknown>;

  // Create a draft mission from the template
  const { data: mission, error: mErr } = await supabase
    .from('missions')
    .insert({
      tenant_id: tenantId,
      title: template.title,
      status: 'draft',
      trust_level: 'conditional',
      ...missionJson,
      source_template: slug,
    })
    .select('id, title, status')
    .single();

  if (mErr || !mission) return NextResponse.json({ error: 'Failed to create mission' }, { status: 500 });

  // Increment use_count on template
  await supabase
    .from('mission_templates')
    .update({ use_count: (template.use_count ?? 0) + 1 })
    .eq('slug', slug);

  // Create agents from template's agent definitions
  const agentDefs = (missionJson.agents as Record<string, unknown>[]) ?? [];
  if (agentDefs.length > 0) {
    await supabase.from('agents').insert(
      agentDefs.map((a, i) => ({
        tenant_id: tenantId,
        mission_id: mission.id,
        name: a.name,
        role: a.role,
        tools: a.tools ?? [],
        agent_index: i,
        status: 'idle',
      }))
    );
  }

  return NextResponse.json({ mission_id: mission.id, mission_title: mission.title, status: 'draft' }, { status: 201 });
}
