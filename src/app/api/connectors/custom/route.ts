import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 15;

// GET /api/connectors/custom
// Returns all custom connectors for the tenant (never returns the actual token)
export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('tenant_permissions')
    .select('provider, scopes, metadata, updated_at')
    .eq('tenant_id', tenantId)
    .contains('scopes', ['custom'])
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connectors: data ?? [] });
}

// POST /api/connectors/custom
// Save a custom connector with name, key, base_url, auth_type
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const body = await request.json() as {
      name: string;
      api_key: string;
      base_url?: string;
      auth_type?: string;
      auth_header?: string;
    };

    const { name, api_key, base_url, auth_type = 'bearer', auth_header } = body;

    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!api_key?.trim()) return NextResponse.json({ error: 'api_key is required' }, { status: 400 });

    // Provider slug: lowercase, spaces to underscores, prefix with custom_
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const provider = `custom_${slug}`;

    const metadata = {
      display_name: name.trim(),
      base_url: base_url?.trim() || null,
      auth_type,
      auth_header: auth_header?.trim() || null,
    };

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('tenant_permissions')
      .upsert({
        tenant_id: tenantId,
        provider,
        access_token: api_key.trim(),
        refresh_token: null,
        expires_at: null,
        scopes: ['apikey', 'custom'],
        metadata,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,provider' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, provider, display_name: name.trim() });
  } catch (err) {
    console.error('[POST /api/connectors/custom]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/connectors/custom?provider=custom_xxx
export async function DELETE(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const provider = new URL(request.url).searchParams.get('provider');
  if (!provider) return NextResponse.json({ error: 'provider is required' }, { status: 400 });
  if (!provider.startsWith('custom_')) {
    return NextResponse.json({ error: 'Only custom connectors can be deleted here' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('tenant_permissions')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('provider', provider);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
