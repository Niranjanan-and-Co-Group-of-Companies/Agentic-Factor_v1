// Extracts readable text from every supported file type.
// Used by /api/upload-file to produce content that gets chunked + embedded
// into the RAG vector store (tenant_assets / asset_chunks tables).

export interface ExtractResult {
  text: string;
  summary: string;         // one-line description for the tenant_assets title
  assetType: 'file' | 'text' | 'image';
}

// Vision provider config — passed from upload route so tenant's connected AI
// is used when available. Priority: OpenAI (GPT-4o) → Gemini → Claude Haiku.
export interface VisionConfig {
  anthropicKey: string;  // platform key — always present as final fallback
  openaiKey?: string;    // tenant's OpenAI key → GPT-4o vision
  geminiKey?: string;    // tenant's Gemini key → Gemini Flash vision
}

// Image MIME types — sent to Claude Vision for description + text extraction
const IMAGE_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/gif', 'image/bmp', 'image/tiff', 'image/svg+xml',
  'image/heic', 'image/heif',
]);

// Plain-text formats — read directly as UTF-8
const TEXT_MIMES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html',
  'text/xml', 'application/json', 'application/xml',
  'application/javascript', 'application/typescript',
  'text/javascript', 'text/typescript',
  'text/x-python', 'text/x-java', 'text/x-c',
  'application/x-yaml', 'text/yaml',
]);

export async function extractFileContent(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  anthropicApiKey: string,
  visionConfig?: Pick<VisionConfig, 'openaiKey' | 'geminiKey'>
): Promise<ExtractResult> {
  const lower = fileName.toLowerCase();
  const vision: VisionConfig = { anthropicKey: anthropicApiKey, ...visionConfig };

  // ── Images ─────────────────────────────────────────────────────────────────
  if (IMAGE_MIMES.has(mimeType) || /\.(jpe?g|png|webp|gif|bmp|tiff?|svg|heic|heif)$/i.test(lower)) {
    return extractImage(buffer, fileName, mimeType, vision);
  }

  // ── PDF ────────────────────────────────────────────────────────────────────
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    return extractPdf(buffer, fileName);
  }

  // ── DOCX / DOC ─────────────────────────────────────────────────────────────
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    lower.endsWith('.docx') || lower.endsWith('.doc')
  ) {
    return extractDocx(buffer, fileName);
  }

  // ── Excel (XLSX / XLS) ─────────────────────────────────────────────────────
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    lower.endsWith('.xlsx') || lower.endsWith('.xls')
  ) {
    return extractExcel(buffer, fileName);
  }

  // ── PowerPoint (PPTX / PPT) ────────────────────────────────────────────────
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    lower.endsWith('.pptx') || lower.endsWith('.ppt')
  ) {
    return extractPptx(buffer, fileName);
  }

  // ── ZIP archive ────────────────────────────────────────────────────────────
  if (mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed' || lower.endsWith('.zip')) {
    return extractZip(buffer, fileName, vision);
  }

  // ── CSV (explicit check before plain-text fallback) ────────────────────────
  if (mimeType === 'text/csv' || lower.endsWith('.csv')) {
    const text = buffer.toString('utf-8');
    const rows = text.split('\n').slice(0, 5).join('\n');
    return {
      text,
      summary: `CSV file: ${fileName} (${text.split('\n').length - 1} rows) — preview: ${rows.slice(0, 120)}`,
      assetType: 'text',
    };
  }

  // ── Plain text / JSON / code / markdown ────────────────────────────────────
  if (TEXT_MIMES.has(mimeType) || /\.(txt|md|json|xml|yaml|yml|js|ts|jsx|tsx|py|rb|go|rs|html|css)$/i.test(lower)) {
    const text = buffer.toString('utf-8');
    return {
      text,
      summary: `${fileName} (${text.length} chars)`,
      assetType: 'text',
    };
  }

  // ── Fallback: treat as text ────────────────────────────────────────────────
  const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, '').trim();
  if (text.length > 50) {
    return { text, summary: fileName, assetType: 'text' };
  }
  return {
    text: `Binary file uploaded: ${fileName} (${Math.round(buffer.length / 1024)}KB). File stored for reference.`,
    summary: `Binary: ${fileName}`,
    assetType: 'file',
  };
}

// ── Extractors ─────────────────────────────────────────────────────────────

const IMAGE_PROMPT = 'Describe this image in detail. Extract ALL visible text, numbers, data, and labels exactly as they appear. Include: subject matter, key elements, any charts/graphs/tables data, any text overlays, and overall context. Be thorough — this description is used for search and retrieval.';

async function extractImage(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  vision: VisionConfig
): Promise<ExtractResult> {
  const base64 = buffer.toString('base64');
  // Normalise MIME for providers that don't accept heic/heif
  const safeMime = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as string[]).includes(mimeType)
    ? mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    : 'image/jpeg' as const;

  // ── 1st choice: tenant's OpenAI key → GPT-4o vision ──────────────────────
  if (vision.openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${vision.openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${safeMime};base64,${base64}`, detail: 'high' } },
              { type: 'text', text: IMAGE_PROMPT },
            ],
          }],
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.ok) {
        const data = await res.json() as { choices: Array<{ message: { content: string } }> };
        const description = data.choices?.[0]?.message?.content ?? '';
        if (description) {
          return { text: `Image: ${fileName}\n\n${description}`, summary: `Image: ${fileName} — ${description.slice(0, 100)}`, assetType: 'image' };
        }
      }
    } catch { /* fall through */ }
  }

  // ── 2nd choice: tenant's Gemini key → Gemini Flash vision ────────────────
  if (vision.geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${vision.geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: safeMime, data: base64 } },
              { text: IMAGE_PROMPT },
            ]}],
          }),
          signal: AbortSignal.timeout(25_000),
        }
      );
      if (res.ok) {
        const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
        const description = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (description) {
          return { text: `Image: ${fileName}\n\n${description}`, summary: `Image: ${fileName} — ${description.slice(0, 100)}`, assetType: 'image' };
        }
      }
    } catch { /* fall through */ }
  }

  // ── Fallback: platform Claude Haiku vision ────────────────────────────────
  if (vision.anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': vision.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: safeMime, data: base64 } },
            { type: 'text', text: IMAGE_PROMPT },
          ]}],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const data = await res.json() as { content: Array<{ text: string }> };
        const description = data.content?.[0]?.text ?? '';
        if (description) {
          return { text: `Image: ${fileName}\n\n${description}`, summary: `Image: ${fileName} — ${description.slice(0, 100)}`, assetType: 'image' };
        }
      }
    } catch { /* fall through */ }
  }

  return {
    text: `Image uploaded: ${fileName} (${Math.round(buffer.length / 1024)}KB)`,
    summary: `Image: ${fileName}`,
    assetType: 'image',
  };
}

async function extractPdf(buffer: Buffer, fileName: string): Promise<ExtractResult> {
  try {
    const pdfParseModule = await import('pdf-parse') as { default?: (b: Buffer) => Promise<{ text: string; numpages: number }> };
    const pdfParse = pdfParseModule.default ?? (pdfParseModule as unknown as (b: Buffer) => Promise<{ text: string; numpages: number }>);
    const data = await pdfParse(buffer);
    return {
      text: data.text,
      summary: `PDF: ${fileName} (${data.numpages} pages)`,
      assetType: 'file',
    };
  } catch (err) {
    console.error('[file-extractor] PDF parse error:', err);
    return { text: `PDF file: ${fileName}`, summary: `PDF: ${fileName}`, assetType: 'file' };
  }
}

async function extractDocx(buffer: Buffer, fileName: string): Promise<ExtractResult> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: result.value,
      summary: `Document: ${fileName}`,
      assetType: 'file',
    };
  } catch (err) {
    console.error('[file-extractor] DOCX parse error:', err);
    return { text: `Word document: ${fileName}`, summary: `Document: ${fileName}`, assetType: 'file' };
  }
}

async function extractExcel(buffer: Buffer, fileName: string): Promise<ExtractResult> {
  try {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      parts.push(`=== Sheet: ${sheetName} ===\n${csv}`);
    }
    const text = parts.join('\n\n');
    return {
      text,
      summary: `Spreadsheet: ${fileName} (${workbook.SheetNames.length} sheets)`,
      assetType: 'file',
    };
  } catch (err) {
    console.error('[file-extractor] Excel parse error:', err);
    return { text: `Excel file: ${fileName}`, summary: `Spreadsheet: ${fileName}`, assetType: 'file' };
  }
}

async function extractPptx(buffer: Buffer, fileName: string): Promise<ExtractResult> {
  try {
    // PPTX is a ZIP — extract slide XML files and pull text nodes from them
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter(f => /ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)?.[0] ?? '0');
        const nb = parseInt(b.match(/\d+/)?.[0] ?? '0');
        return na - nb;
      });

    const parts: string[] = [];
    for (const [i, slideName] of slideFiles.entries()) {
      const xml = await zip.files[slideName].async('text');
      // Extract text between <a:t> tags
      const texts = [...xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)].map(m => m[1].trim()).filter(Boolean);
      if (texts.length > 0) parts.push(`Slide ${i + 1}: ${texts.join(' | ')}`);
    }
    const text = parts.join('\n');
    return {
      text: text || `PowerPoint file: ${fileName}`,
      summary: `Presentation: ${fileName} (${slideFiles.length} slides)`,
      assetType: 'file',
    };
  } catch (err) {
    console.error('[file-extractor] PPTX parse error:', err);
    return { text: `PowerPoint: ${fileName}`, summary: `Presentation: ${fileName}`, assetType: 'file' };
  }
}

async function extractZip(
  buffer: Buffer,
  fileName: string,
  vision: VisionConfig
): Promise<ExtractResult> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);

    const fileNames = Object.keys(zip.files).filter(f => !zip.files[f].dir);
    const parts: string[] = [`ZIP archive: ${fileName} (${fileNames.length} files)`];

    // Process up to 20 files inside the ZIP
    let processed = 0;
    for (const name of fileNames.slice(0, 20)) {
      const entry = zip.files[name];
      const entryBuffer = Buffer.from(await entry.async('arraybuffer'));
      // Infer MIME from extension
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      const inferredMime = EXT_TO_MIME[ext] ?? 'application/octet-stream';

      try {
        const result = await extractFileContent(entryBuffer, name, inferredMime, vision.anthropicKey, { openaiKey: vision.openaiKey, geminiKey: vision.geminiKey });
        if (result.text.length > 30) {
          parts.push(`\n--- ${name} ---\n${result.text.slice(0, 3000)}`);
          processed++;
        }
      } catch { /* skip unreadable entries */ }
    }

    return {
      text: parts.join('\n'),
      summary: `ZIP: ${fileName} (${fileNames.length} files, ${processed} processed)`,
      assetType: 'file',
    };
  } catch (err) {
    console.error('[file-extractor] ZIP parse error:', err);
    return { text: `ZIP file: ${fileName}`, summary: `Archive: ${fileName}`, assetType: 'file' };
  }
}

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', tiff: 'image/tiff', svg: 'image/svg+xml',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  xml: 'application/xml', html: 'text/html', yaml: 'application/x-yaml', yml: 'application/x-yaml',
  js: 'text/javascript', ts: 'text/typescript', py: 'text/x-python',
};
