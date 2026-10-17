import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { getAppInfos, missionCatalog } from '@/lib/services/app-catalog';

// ============================================================
// GET /api/catalog/apps?slugs=zoho_books,gmail[&actions=GMAIL_SEND_EMAIL]
// Official name, logo and description of each app, and official
// action labels, from Composio's catalog (any of its apps;
// cached and refreshed daily).
// ============================================================

export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const slugs = (request.nextUrl.searchParams.get('slugs') ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(s => /^[a-z0-9_-]{1,64}$/.test(s)).slice(0, 40);
  const actions = (request.nextUrl.searchParams.get('actions') ?? '')
    .split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z][A-Z0-9_]{3,80}$/.test(s)).slice(0, 40);
  const apps = await getAppInfos(slugs);
  const actionLabels = actions.length ? (await missionCatalog({ permissions: slugs.map(service => ({ type: 'composio_oauth', service })) }, actions)).actionLabels : {};
  return NextResponse.json({ apps, actionLabels }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
}
