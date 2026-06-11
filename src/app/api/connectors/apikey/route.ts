import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 15;

// POST /api/connectors/apikey
// Stores a customer-provided API key (or multi-field credentials) in tenant_permissions.
// Single-field connectors: stores raw string. Multi-field: stores JSON.
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const { provider, fields } = await request.json();

    if (!provider || typeof provider !== 'string') {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }
    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'fields is required' }, { status: 400 });
    }

    const emptyFields = Object.entries(fields as Record<string, string>).filter(([, v]) => !v?.trim());
    if (emptyFields.length > 0) {
      return NextResponse.json(
        { error: `Missing values for: ${emptyFields.map(([k]) => k).join(', ')}` },
        { status: 400 }
      );
    }

    const fieldEntries = Object.entries(fields as Record<string, string>);
    const accessToken =
      fieldEntries.length === 1
        ? fieldEntries[0][1].trim()
        : JSON.stringify(Object.fromEntries(fieldEntries.map(([k, v]) => [k, v.trim()])));

    const supabase = createServiceClient();

    const upsertPayload = {
      tenant_id: tenantId,
      provider,
      access_token: accessToken,
      refresh_token: null,
      expires_at: null,
      scopes: ['apikey'],
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from('tenant_permissions')
      .upsert(upsertPayload, { onConflict: 'tenant_id,provider' });

    if (upsertError) {
      await supabase.from('tenant_permissions').delete().eq('tenant_id', tenantId).eq('provider', provider);
      const { error: insertError } = await supabase.from('tenant_permissions').insert(upsertPayload);
      if (insertError) {
        console.error(`[API Key ${provider}] INSERT failed: ${insertError.message}`);
        return NextResponse.json({ error: 'Failed to store credentials' }, { status: 500 });
      }
    }

    console.log(`[API Key] ✅ Stored ${provider} credentials for tenant ${tenantId}`);
    return NextResponse.json({ success: true, provider });
  } catch (err) {
    console.error('[POST /api/connectors/apikey]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
