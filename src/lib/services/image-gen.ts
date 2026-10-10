/**
 * Images for agents (generate_image() in the sandbox SDK) on the platform's own keys, billed in
 * credits — so a pitch deck or a post with generated visuals needs no image API key from the
 * customer. The fast model leads; the other provider answers when it fails.
 */

export type ImageShape = 'square' | 'landscape' | 'portrait';

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
  model: string;
  /** What the provider charges for this image. */
  costUsd: number;
}

// Overridable without a deploy when the providers ship newer models.
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

const ASPECT: Record<ImageShape, string> = { square: '1:1', landscape: '16:9', portrait: '9:16' };
const OPENAI_SIZE: Record<ImageShape, string> = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' };

export function imageShape(value: unknown): ImageShape {
  return value === 'square' || value === 'portrait' ? value : 'landscape';
}

async function gemini(prompt: string, shape: ImageShape): Promise<GeneratedImage> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ASPECT[shape] } },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Gemini image ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
  const image = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData;
  if (!image?.data) throw new Error('Gemini returned no image (the prompt may have been declined).');
  return { bytes: Buffer.from(image.data, 'base64'), mimeType: image.mimeType ?? 'image/png', model: GEMINI_IMAGE_MODEL, costUsd: 0.039 };
}

async function openai(prompt: string, shape: ImageShape): Promise<GeneratedImage> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` },
    body: JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt, size: OPENAI_SIZE[shape], quality: 'medium', n: 1 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`OpenAI image ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { data?: Array<{ b64_json?: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image.');
  return { bytes: Buffer.from(b64, 'base64'), mimeType: 'image/png', model: OPENAI_IMAGE_MODEL, costUsd: shape === 'square' ? 0.042 : 0.063 };
}

/** One image from the first provider that answers; the error lists every provider's failure. */
export async function generatePlatformImage(prompt: string, shape: ImageShape): Promise<GeneratedImage> {
  const providers = [
    process.env.GEMINI_API_KEY ? () => gemini(prompt, shape) : null,
    process.env.OPENAI_API_KEY ? () => openai(prompt, shape) : null,
  ].filter((p): p is () => Promise<GeneratedImage> => !!p);
  if (providers.length === 0) throw new Error('No image provider is configured on the platform.');
  const errors: string[] = [];
  for (const provider of providers) {
    try { return await provider(); } catch (err) { errors.push((err as Error).message); }
  }
  throw new Error(`Image generation failed: ${errors.join(' | ')}`);
}
