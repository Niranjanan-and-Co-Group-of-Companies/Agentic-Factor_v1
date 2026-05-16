import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';

export const maxDuration = 120;

// Input validation schema
const IngestRequestSchema = z.object({
  sourceUri: z.string().url().max(2048).optional().nullable(),
  content: z.string().max(1_048_576).optional().nullable(), // 1MB max
  missionId: z.string().uuid().optional().nullable(),
  assetType: z.enum(['text', 'image', 'pdf', 'csv', 'json', 'code']).default('text'),
  classification: z.enum(['resource', 'boundary']).default('resource'),
  title: z.string().max(500).default('Uploaded Asset'),
});

export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  try {
    const rawBody = await request.json();
    
    // Validate and sanitize input
    const parseResult = IngestRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    
    const { sourceUri, content, missionId, assetType, classification, title } = parseResult.data;

    if (!content && !sourceUri) {
      return NextResponse.json({ error: 'Must provide content or sourceUri' }, { status: 400 });
    }

    // SSRF protection: block private/internal URLs
    if (sourceUri) {
      const url = new URL(sourceUri);
      const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '[::1]'];
      if (blockedHosts.includes(url.hostname) || url.hostname.endsWith('.internal') || url.hostname.endsWith('.local')) {
        return NextResponse.json({ error: 'Internal URLs are not allowed' }, { status: 400 });
      }
    }

    const supabase = createServiceClient();

    // 1. Create the parent Asset record
    const { data: assetRow, error: assetError } = await supabase
      .from('tenant_assets')
      .insert({
        tenant_id: tenantId,
        mission_id: missionId || null,
        asset_type: assetType || 'text',
        classification,
        source_uri: sourceUri || 'manual_input',
        title: title || 'Uploaded Asset',
      })
      .select('id')
      .single();

    if (assetError || !assetRow) {
      throw new Error(`Failed to create asset: ${assetError?.message}`);
    }

    const assetId = assetRow.id;

    // 2. Extract content
    let textToProcess = content;
    if (!textToProcess && sourceUri) {
      const res = await fetch(sourceUri);
      textToProcess = await res.text();
    }

    // 2b. Handle base64 binary files (PDF, DOCX) from FileDropZone
    if (textToProcess && textToProcess.startsWith('__BASE64_BINARY__:')) {
      const parts = textToProcess.split(':');
      const fileName = parts[1];
      const base64Data = parts.slice(2).join(':');
      const buffer = Buffer.from(base64Data, 'base64');

      if (fileName.endsWith('.pdf')) {
        try {
          const pdfParseModule: any = await import('pdf-parse');
          const pdfParse = pdfParseModule.default || pdfParseModule;
          const pdfData = await pdfParse(buffer);
          textToProcess = pdfData.text;
        } catch (e) {
          console.error('[Ingest] PDF parse failed:', e);
          return NextResponse.json({ error: 'Failed to parse PDF' }, { status: 400 });
        }
      } else if (fileName.endsWith('.docx')) {
        try {
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ buffer });
          textToProcess = result.value;
        } catch (e) {
          console.error('[Ingest] DOCX parse failed:', e);
          return NextResponse.json({ error: 'Failed to parse DOCX' }, { status: 400 });
        }
      } else {
        textToProcess = buffer.toString('utf-8');
      }
    }

    // 3. Chunking logic
    if (!textToProcess || textToProcess.length === 0) {
      return NextResponse.json({ error: 'No content to process' }, { status: 400 });
    }
    
    const chunkSize = 2000; 
    const chunks: string[] = [];
    for (let i = 0; i < textToProcess.length; i += chunkSize) {
      chunks.push(textToProcess.substring(i, i + chunkSize));
    }

    // 4. Generate real embeddings and insert chunks
    // Uses OpenAI text-embedding-3-small (1536 dims) via generateEmbedding()
    const { generateEmbedding } = await import('@/lib/services/llm-router');
    
    // Batch embeddings: process 10 chunks at a time to avoid rate limits
    const BATCH_SIZE = 10;
    let insertedChunks = 0;
    
    for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
      const batch = chunks.slice(batchStart, batchStart + BATCH_SIZE);
      
      const embedResults = await Promise.all(
        batch.map(async (chunk) => {
          const embedding = await generateEmbedding(chunk);
          return { chunk, embedding };
        })
      );
      
      for (const { chunk, embedding } of embedResults) {
        if (!embedding) {
          console.warn('[Ingest] No embedding provider available — skipping chunk. Set OPENAI_API_KEY for real embeddings.');
          continue;
        }
        
        const vectorString = `[${embedding.join(',')}]`;
        const { error: chunkError } = await supabase
          .from('asset_chunks')
          .insert({
            asset_id: assetId,
            tenant_id: tenantId,
            mission_id: missionId || null,
            content: chunk,
            classification,
            embedding: vectorString,
          });
        if (chunkError) {
          console.error("Chunk insert error:", chunkError);
        } else {
          insertedChunks++;
        }
      }
    }
    
    if (insertedChunks === 0 && chunks.length > 0) {
      console.warn('[Ingest] No chunks were embedded. Ensure OPENAI_API_KEY is set for embeddings.');
    }

    // 5. Fire an event
    await supabase.from('events').insert({
      tenant_id: tenantId,
      event_type: 'mission.asset_ingested',
      entity_type: 'mission',
      entity_id: missionId,
      payload: { assetId, classification, chunks: chunks.length },
    });

    return NextResponse.json({ success: true, assetId, chunksGenerated: chunks.length });

  } catch (error: any) {
    console.error('[API/Ingest] Error:', error);
    return NextResponse.json({ error: 'Ingestion failed', message: error.message }, { status: 500 });
  }
}
