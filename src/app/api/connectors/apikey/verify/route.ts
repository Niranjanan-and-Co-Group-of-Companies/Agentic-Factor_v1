import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { verifyApiKey } from '@/lib/services/apikey-verifier';

export const maxDuration = 15;

// POST /api/connectors/apikey/verify
// Tests a customer-provided API key against the real service before saving.
// Returns { verified: true } or { verified: false, error: string }
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;

  try {
    const { provider, fields } = await request.json() as {
      provider: string;
      fields: Record<string, string>;
    };

    if (!provider || !fields) {
      return NextResponse.json({ verified: false, error: 'provider and fields are required' }, { status: 400 });
    }

    const result = await verifyApiKey(provider, fields);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST /api/connectors/apikey/verify]', err);
    return NextResponse.json({ verified: false, error: 'Verification request failed' }, { status: 500 });
  }
}
