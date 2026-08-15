import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .single();

  if (error || !data) {
    return NextResponse.json({ completed: [] });
  }

  const completed: string[] = (data.settings as Record<string, unknown>)?.onboarding_completed as string[] ?? [];
  return NextResponse.json({ completed });
}

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const body = await request.json() as { completed: string[] };
  const completed: string[] = Array.isArray(body.completed) ? body.completed : [];

  const supabase = createServiceClient();

  // Read current settings first to avoid overwriting other keys
  const { data: existing } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .single();

  const currentSettings = (existing?.settings ?? {}) as Record<string, unknown>;
  const updatedSettings = { ...currentSettings, onboarding_completed: completed };

  await supabase
    .from('tenants')
    .upsert({ id: tenantId, settings: updatedSettings }, { onConflict: 'id' });

  return NextResponse.json({ ok: true, completed });
}
