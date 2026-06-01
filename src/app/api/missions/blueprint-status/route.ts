import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// ============================================================
// GET /api/missions/blueprint-status?jobId=xxx
//
// Polling endpoint for async blueprint generation.
// Frontend calls this every 3 seconds to check progress.
//
// Returns:
//   { status: 'processing', step: 'Analyzing your intent...' }
//   { status: 'discovery', question: '...' }
//   { status: 'completed', blueprint: {...}, meta: {...} }
//   { status: 'failed', error: '...' }
//   { status: 'pending' }  — job just started, no updates yet
// ============================================================

export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    // Get the latest job update event
    const { data: events } = await supabase
      .from('events')
      .select('payload, created_at')
      .eq('tenant_id', tenantId)
      .eq('entity_id', jobId)
      .eq('event_type', 'blueprint.job_update')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!events || events.length === 0) {
      // No events yet — job was just submitted
      return NextResponse.json({
        status: 'pending',
        step: 'Starting blueprint generation...',
      });
    }

    const latest = events[0].payload as any;

    // Return based on status
    switch (latest.status) {
      case 'processing':
        return NextResponse.json({
          status: 'processing',
          step: latest.step || 'Generating...',
        });

      case 'discovery':
        return NextResponse.json({
          status: 'discovery',
          question: latest.question,
        });

      case 'completed':
        return NextResponse.json({
          status: 'completed',
          blueprint: latest.blueprint,
          rawLLMOutput: latest.rawLLMOutput,
          meta: latest.meta,
        });

      case 'failed':
        return NextResponse.json({
          status: 'failed',
          error: latest.error || 'Blueprint generation failed',
        });

      default:
        return NextResponse.json({
          status: latest.status || 'unknown',
          step: 'Processing...',
        });
    }
  } catch (error) {
    console.error('[blueprint-status] Error:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
}
