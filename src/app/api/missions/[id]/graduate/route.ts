import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';

// POST /api/missions/[id]/graduate
// Lets the customer skip remaining training runs and move a mission straight
// to live execution — every write action goes back to its normal trust-level
// behavior instead of always pausing for review.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    const { createServiceClient } = await import('@/lib/supabase/server');
    const supabase = createServiceClient();

    const { error } = await supabase
      .from('missions')
      .update({
        training_enabled: false,
        training_graduated_at: new Date().toISOString(),
      })
      .eq('id', missionId)
      .eq('tenant_id', tenantId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Mission graduated to live execution.' });
  } catch (error) {
    console.error(`[POST /api/missions/${missionId}/graduate] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to graduate mission', details: (error as Error).message },
      { status: 500 }
    );
  }
}
