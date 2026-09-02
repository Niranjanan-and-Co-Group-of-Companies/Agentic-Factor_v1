import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { extractFileContent } from '@/lib/services/file-extractor';

export const maxDuration = 60;

const STORAGE_BUCKET = 'tenant-uploads';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// POST /api/upload-file
// Accepts: multipart/form-data  { file: File, missionId?: string }
// Stores the file in Supabase Storage, extracts text content, chunks it,
// embeds it into pgvector — all scoped to tenant + mission.
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const missionId = (formData.get('missionId') as string | null) || null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large — maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB` }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || 'application/octet-stream';
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uuid = crypto.randomUUID();

    // ── 1. Upload raw file to Supabase Storage ──────────────────────────────
    const supabase = createServiceClient();

    // Ensure bucket exists (service role can create)
    await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: false,
      allowedMimeTypes: undefined, // allow all
    }).catch(() => { /* bucket already exists — ignore */ });

    const storagePath = missionId
      ? `${tenantId}/${missionId}/${uuid}-${safeFileName}`
      : `${tenantId}/platform/${uuid}-${safeFileName}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

    if (uploadError) {
      console.error('[upload-file] Storage upload error:', uploadError);
      return NextResponse.json({ error: 'Storage upload failed' }, { status: 500 });
    }

    // ── 2. Resolve tenant AI keys for smart vision ──────────────────────────
    // Images are described by the best available vision model:
    // tenant's OpenAI (GPT-4o) → tenant's Gemini → platform Claude Haiku
    const { data: aiPerms } = await supabase
      .from('tenant_permissions')
      .select('provider, access_token')
      .eq('tenant_id', tenantId)
      .in('provider', ['openai', 'gemini']);

    const openaiPerm = aiPerms?.find(p => p.provider === 'openai');
    const geminiPerm = aiPerms?.find(p => p.provider === 'gemini');

    const visionConfig = {
      openaiKey: openaiPerm?.access_token && openaiPerm.access_token !== 'composio_managed'
        ? (openaiPerm.access_token as string) : undefined,
      geminiKey: geminiPerm?.access_token && geminiPerm.access_token !== 'composio_managed'
        ? (geminiPerm.access_token as string) : undefined,
    };

    // ── 3. Extract text content ─────────────────────────────────────────────
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? '';
    const extracted = await extractFileContent(buffer, file.name, mimeType, anthropicApiKey, visionConfig);

    // ── 4. Create tenant_assets record ─────────────────────────────────────
    // DB constraint: asset_type IN ('url', 'file', 'text') — map 'image' → 'file'
    const { data: assetRow, error: assetError } = await supabase
      .from('tenant_assets')
      .insert({
        tenant_id: tenantId,
        mission_id: missionId || null,
        asset_type: extracted.assetType === 'image' ? 'file' : extracted.assetType,
        classification: 'resource',
        source_uri: storagePath,
        title: extracted.summary.slice(0, 500),
      })
      .select('id')
      .single();

    if (assetError || !assetRow) {
      console.error('[upload-file] Asset insert error:', assetError);
      return NextResponse.json({ error: 'Failed to register asset' }, { status: 500 });
    }

    const assetId = assetRow.id;

    // ── 5. Chunk + embed ────────────────────────────────────────────────────
    // Run asynchronously — client gets a response immediately, embeddings
    // are ready within a few seconds.
    embedAsync(supabase, assetId, tenantId, missionId, extracted.text).catch(err =>
      console.error('[upload-file] Embed error:', err)
    );

    return NextResponse.json({
      success: true,
      assetId,
      fileName: file.name,
      fileType: extracted.assetType,
      summary: extracted.summary,
      preview: extracted.text.slice(0, 300).trim(),
      storagePath,
    });

  } catch (err) {
    console.error('[POST /api/upload-file]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

async function embedAsync(
  supabase: ReturnType<typeof createServiceClient>,
  assetId: string,
  tenantId: string,
  missionId: string | null,
  text: string
) {
  if (!text || text.length < 20) return;

  const { generateEmbedding } = await import('@/lib/services/llm-router');

  // Chunk at 2000 chars with 200-char overlap
  const CHUNK_SIZE = 2000;
  const OVERLAP = 200;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE - OVERLAP) {
    const chunk = text.slice(i, i + CHUNK_SIZE).trim();
    if (chunk.length > 30) chunks.push(chunk);
  }

  // Batch in groups of 10 to stay within rate limits
  const BATCH = 10;
  for (let b = 0; b < chunks.length; b += BATCH) {
    const batch = chunks.slice(b, b + BATCH);
    await Promise.all(batch.map(async (chunk, idx) => {
      const embedding = await generateEmbedding(chunk);
      if (!embedding) return;
      const vectorString = `[${embedding.join(',')}]`;
      const { error } = await supabase.from('asset_chunks').insert({
        asset_id: assetId,
        tenant_id: tenantId,
        mission_id: missionId || null,
        content: chunk,
        classification: 'resource',
        embedding: vectorString,
        // chunk_index isn't in the original schema — omit
      });
      if (error) console.error(`[upload-file] Chunk ${b + idx} insert error:`, error);
    }));
  }
}
