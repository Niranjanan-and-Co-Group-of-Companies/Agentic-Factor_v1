import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createComposioApiKeyConnection } from '@/lib/services/composio';

// ============================================================
// POST /api/composio/connect-apikey
// Body: { provider: string; apiKey: string }
//
// Registers an API key credential directly with Composio —
// no OAuth redirect needed. Used for API_KEY / BEARER_TOKEN
// services like Perplexity, ElevenLabs, Tavily, etc.
//
// After this call, Composio treats the credential the same as
// an OAuth-connected account: tool schemas load, action execution
// works, connected account list returns it.
// ============================================================

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { tenantId } = authResult;

  const { provider, apiKey } = await request.json() as { provider?: string; apiKey?: string };

  if (!provider || !apiKey?.trim()) {
    return NextResponse.json({ error: 'provider and apiKey are required' }, { status: 400 });
  }

  try {
    await createComposioApiKeyConnection(tenantId, provider, apiKey.trim());
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Composio connect-apikey]', err);
    // Non-fatal — local storage already has the key.
    // Return 200 so the client doesn't surface this as a user-visible error.
    return NextResponse.json({ success: false, warning: (err as Error).message });
  }
}
