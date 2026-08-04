import { NextRequest, NextResponse } from 'next/server';
import Composio from '@composio/client';

// ============================================================
// GET /api/composio/apps?limit=50&cursor=...&search=...
// Returns paginated toolkit catalog with logo URLs.
// Used by the connectors page "All Integrations" section.
// ============================================================

let _client: Composio | null = null;
function getClient() {
  if (!_client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) throw new Error('COMPOSIO_API_KEY not configured');
    _client = new Composio({ apiKey });
  }
  return _client;
}

// Cache full list in memory for 10 minutes — catalog rarely changes.
let catalogCache: { data: unknown; expiresAt: number } | null = null;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = Math.min(Number(searchParams.get('limit') ?? '100'), 200);
  const cursor = searchParams.get('cursor') ?? undefined;
  const search = searchParams.get('search')?.toLowerCase() ?? '';

  try {
    // Serve from cache when no search (full catalog fetch)
    if (!search && catalogCache && catalogCache.expiresAt > Date.now()) {
      return NextResponse.json(catalogCache.data);
    }

    const client = getClient();
    const result = await client.toolkits.list({
      limit,
      cursor,
      ...(search ? { search } : {}),
    } as any);

    const items = ((result as any).items ?? []).map((tk: any) => ({
      slug: tk.slug,
      name: tk.name,
      logo: tk.meta?.logo ?? `https://logos.composio.dev/api/${tk.slug}`,
      description: tk.meta?.description ?? '',
      categories: (tk.meta?.categories ?? []).map((c: any) => c.name ?? c.id ?? c),
      tools_count: tk.meta?.tools_count ?? 0,
      auth_schemes: tk.auth_schemes ?? [],
      no_auth: tk.no_auth ?? false,
    }));

    const payload = {
      items,
      next_cursor: (result as any).next_cursor ?? null,
      total_items: (result as any).total_items ?? items.length,
    };

    if (!search) {
      catalogCache = { data: payload, expiresAt: Date.now() + 10 * 60 * 1000 };
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error('[composio/apps]', err);
    return NextResponse.json({ error: 'Failed to fetch integrations' }, { status: 500 });
  }
}
