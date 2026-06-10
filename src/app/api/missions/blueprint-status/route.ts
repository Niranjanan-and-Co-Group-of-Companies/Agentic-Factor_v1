import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 300; // SSE can stay open for up to 5 minutes

// ============================================================
// GET /api/missions/blueprint-status?jobId=xxx
//
// Supports two modes:
//   1. SSE streaming: Accept: text/event-stream → keeps connection open,
//      pushes events every 2s until completed/failed/discovery
//   2. Polling (legacy): returns JSON snapshot
// ============================================================

export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const acceptHeader = request.headers.get('accept') || '';
  const wantsSSE = acceptHeader.includes('text/event-stream');

  // ── SSE Streaming Mode ──
  if (wantsSSE) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        let lastStatus = '';
        let pollCount = 0;
        const MAX_POLLS = 150; // 150 * 2s = 5 minutes max

        try {
          while (pollCount < MAX_POLLS) {
            const supabase = createServiceClient();

            const { data: events } = await supabase
              .from('events')
              .select('payload, created_at')
              .eq('tenant_id', tenantId)
              .eq('entity_id', jobId)
              .eq('event_type', 'blueprint.job_update')
              .order('created_at', { ascending: false })
              .limit(1);

            if (!events || events.length === 0) {
              sendEvent({ status: 'pending', step: 'Starting blueprint generation...' });
            } else {
              const latest = events[0].payload as any;
              const currentStatus = latest.status;

              // Always send update (even if same status, step might change)
              switch (currentStatus) {
                case 'processing':
                  sendEvent({ status: 'processing', step: latest.step || 'Generating...' });
                  break;

                case 'discovery':
                  sendEvent({ status: 'discovery', question: latest.question });
                  // Terminal state for SSE — client will close connection
                  controller.close();
                  return;

                case 'completed':
                  sendEvent({
                    status: 'completed',
                    blueprint: latest.blueprint,
                    rawLLMOutput: latest.rawLLMOutput,
                    meta: latest.meta,
                  });
                  // Terminal state
                  controller.close();
                  return;

                case 'failed':
                  sendEvent({ status: 'failed', error: latest.error || 'Blueprint generation failed' });
                  controller.close();
                  return;

                default:
                  sendEvent({ status: currentStatus || 'unknown', step: 'Processing...' });
              }

              lastStatus = currentStatus;
            }

            pollCount++;
            // Wait 2 seconds before next check
            await new Promise(resolve => setTimeout(resolve, 2000));
          }

          // Exceeded max polls
          sendEvent({ status: 'failed', error: 'Blueprint generation timed out after 5 minutes. Please try again.' });
          controller.close();

        } catch (error) {
          console.error('[blueprint-status SSE] Error:', error);
          sendEvent({ status: 'failed', error: 'Connection error. Please try again.' });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      },
    });
  }

  // ── Legacy Polling Mode (unchanged) ──
  try {
    const supabase = createServiceClient();

    const { data: events } = await supabase
      .from('events')
      .select('payload, created_at')
      .eq('tenant_id', tenantId)
      .eq('entity_id', jobId)
      .eq('event_type', 'blueprint.job_update')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!events || events.length === 0) {
      return NextResponse.json({
        status: 'pending',
        step: 'Starting blueprint generation...',
      });
    }

    const latest = events[0].payload as any;

    switch (latest.status) {
      case 'processing':
        return NextResponse.json({ status: 'processing', step: latest.step || 'Generating...' });
      case 'discovery':
        return NextResponse.json({ status: 'discovery', question: latest.question });
      case 'completed':
        return NextResponse.json({
          status: 'completed',
          blueprint: latest.blueprint,
          rawLLMOutput: latest.rawLLMOutput,
          meta: latest.meta,
        });
      case 'failed':
        return NextResponse.json({ status: 'failed', error: latest.error || 'Blueprint generation failed' });
      default:
        return NextResponse.json({ status: latest.status || 'unknown', step: 'Processing...' });
    }
  } catch (error) {
    console.error('[blueprint-status] Error:', error);
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 });
  }
}
