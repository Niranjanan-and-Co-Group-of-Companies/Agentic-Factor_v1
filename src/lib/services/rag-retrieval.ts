// Semantic retrieval from tenant_assets / asset_chunks using pgvector.
// Called before every LLM call in both chat routes to inject relevant context
// from documents the customer has uploaded — scoped strictly to their tenant
// and the specific mission they are working in.

import { createServiceClient } from '@/lib/supabase/server';

interface ChunkRow {
  id: string;
  asset_id: string;
  content: string;
  classification: string;
  similarity: number;
}

interface AssetRow {
  id: string;
  title: string;
  asset_type: string;
  created_at: string;
}

// Returns a formatted context block to inject into the system prompt,
// or null if no relevant chunks exist.
export async function retrieveRelevantChunks(
  tenantId: string,
  missionId: string | null,
  query: string,
  maxChunks = 4,
  threshold = 0.35
): Promise<string | null> {
  if (!query || query.length < 3) return null;

  try {
    const { generateEmbedding } = await import('@/lib/services/llm-router');
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) return null;

    const supabase = createServiceClient();

    // Call the existing match_asset_chunks pgvector function.
    // The function returns chunks where mission_id = p_mission_id OR mission_id IS NULL.
    // For Command Center (no mission), pass a zero UUID so only null-mission chunks match.
    const { data: chunks, error } = await supabase.rpc('match_asset_chunks', {
      query_embedding: `[${queryEmbedding.join(',')}]`,
      match_threshold: threshold,
      match_count: maxChunks,
      p_tenant_id: tenantId,
      p_mission_id: missionId ?? null,
    }) as { data: ChunkRow[] | null; error: unknown };

    if (error || !chunks || chunks.length === 0) return null;

    // Fetch asset titles for the retrieved chunks
    const assetIds = [...new Set(chunks.map(c => c.asset_id))];
    const { data: assets } = await supabase
      .from('tenant_assets')
      .select('id, title, asset_type, created_at')
      .in('id', assetIds) as { data: AssetRow[] | null };

    const assetMap = new Map((assets ?? []).map(a => [a.id, a]));

    // Build formatted context block
    const lines: string[] = ['═══ CONTEXT FROM UPLOADED DOCUMENTS (use this when answering) ═══'];

    for (const chunk of chunks) {
      const asset = assetMap.get(chunk.asset_id);
      const title = asset?.title ?? 'Uploaded document';
      const age = asset?.created_at
        ? formatAge(new Date(asset.created_at))
        : '';
      lines.push(`\n[${title}${age ? ' · ' + age : ''}]`);
      lines.push(chunk.content.trim());
    }

    return lines.join('\n');
  } catch (err) {
    console.error('[rag-retrieval] Error:', err);
    return null;
  }
}

// Returns a brief list of document titles for the AI's awareness — injected
// once into the system prompt so the AI knows what the customer has shared.
export async function listUploadedDocuments(
  tenantId: string,
  missionId: string | null
): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const query = supabase
      .from('tenant_assets')
      .select('title, asset_type, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (missionId) {
      query.eq('mission_id', missionId);
    } else {
      query.is('mission_id', null);
    }

    const { data } = await query as { data: AssetRow[] | null };
    if (!data || data.length === 0) return null;

    const lines = data.map(d => `  • ${d.title} (${formatAge(new Date(d.created_at))})`);
    return `═══ DOCUMENTS UPLOADED BY CUSTOMER ═══\n${lines.join('\n')}\n(You can reference these when relevant — relevant chunks are injected below if the user's message matches.)`;
  } catch {
    return null;
  }
}

function formatAge(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
