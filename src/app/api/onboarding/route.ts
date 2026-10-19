import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';

// Which onboarding steps the customer has finished, kept on their own account (user metadata).
// It used to read and write a `tenants` table that doesn't exist, so progress was never saved.

export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;

  const { data } = await createServiceClient().auth.admin.getUserById(authResult.userId);
  const completed = data?.user?.user_metadata?.onboarding_completed;
  return NextResponse.json({ completed: Array.isArray(completed) ? completed.filter((s): s is string => typeof s === 'string') : [] });
}

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;

  const body = await request.json().catch(() => ({})) as { completed?: unknown };
  const completed = Array.isArray(body.completed)
    ? [...new Set(body.completed.filter((s): s is string => typeof s === 'string' && s.length <= 64))].slice(0, 50)
    : [];

  const supabase = createServiceClient();
  const { data } = await supabase.auth.admin.getUserById(authResult.userId);
  // Keep the other metadata (name, avatar…) as it is.
  const { error } = await supabase.auth.admin.updateUserById(authResult.userId, {
    user_metadata: { ...(data?.user?.user_metadata ?? {}), onboarding_completed: completed },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, completed });
}
