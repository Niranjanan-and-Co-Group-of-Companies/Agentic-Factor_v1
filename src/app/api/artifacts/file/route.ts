import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { ARTIFACT_BUCKET, ARTIFACT_LINK_TTL_SECONDS, artifactBelongsTo } from '@/lib/services/artifact-links';

// ============================================================
// GET /api/artifacts/file?path=<tenant>/<mission>/<agent>/<file>[&download=1]
//
// Opens a file an agent created, for signed-in members of the workspace that owns it only: the
// response is a redirect to a signed URL of the private bucket that expires in a few minutes.
// Another workspace's path answers 404, exactly like a missing file.
// ============================================================

export async function GET(request: NextRequest) {
  const auth = await extractTenantContext(request);
  if (isAuthError(auth)) return auth;

  const path = request.nextUrl.searchParams.get('path') ?? '';
  const notFound = NextResponse.json({ error: 'File not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!artifactBelongsTo(path, auth.tenantId)) return notFound;

  const download = request.nextUrl.searchParams.get('download') === '1';
  const { data, error } = await createServiceClient().storage
    .from(ARTIFACT_BUCKET)
    .createSignedUrl(path, ARTIFACT_LINK_TTL_SECONDS, download ? { download: path.split('/').pop() } : undefined);
  if (error || !data?.signedUrl) return notFound;

  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
