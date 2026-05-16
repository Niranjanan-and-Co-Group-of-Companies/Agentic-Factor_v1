import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { executeMission } from '@/lib/services/runtime/executor';
import { after } from 'next/server';

export const maxDuration = 300; // 5 minute max for Vercel Pro

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;
  const { id: missionId } = await context.params;

  try {
    const { verifyMissionPermissions } = await import('@/lib/services/oauth-refresher');
    
    // Check if we have the required tokens
    const missingProviders = await verifyMissionPermissions(missionId, tenantId);
    
    if (missingProviders.length > 0) {
      return NextResponse.json(
        { 
          error: 'missing_permission', 
          providers: missingProviders,
          message: `Missing permissions for: ${missingProviders.join(', ')}`
        }, 
        { status: 403 }
      );
    }

    // Use Next.js `after()` to keep the function alive after sending the response.
    // This is the production-ready way to run background work on Vercel.
    // The mission execution continues even after the HTTP response is sent.
    after(async () => {
      try {
        await executeMission(missionId, tenantId);
      } catch (err) {
        console.error(`[Background Execution Error] Mission ${missionId}:`, err);
      }
    });

    return NextResponse.json({ success: true, message: 'Execution started' });
  } catch (error) {
    console.error(`[POST /api/missions/${missionId}/execute] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to start execution', details: (error as Error).message },
      { status: 500 }
    );
  }
}
