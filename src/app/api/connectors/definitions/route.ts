import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/connectors/definitions
// Returns active connector definitions from DB.
// Public endpoint (no auth needed — just reads active connectors).
// ============================================================

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('connector_definitions')
      .select('id, label, description, category, status, provider, scopes, icon_svg, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.warn('[Connectors] Failed to fetch from DB:', error.message);
      return NextResponse.json({ connectors: [] });
    }

    return NextResponse.json({ connectors: data || [] });
  } catch {
    return NextResponse.json({ connectors: [] });
  }
}
