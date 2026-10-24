// Voice in the chat — speech to text and replies read aloud — billed like chat: real cost × 3.
// A day's voice use is rounded up once (a 10-second message is a fraction of a credit), and nothing is
// charged when the customer's own key paid for it.

import { chargeTowards } from '@/lib/middleware/billing';
import { readDecryptedToken } from '@/lib/services/vault';
import type { EngineKeys } from '@/lib/services/speech';

/** Charges a voice cost towards the day's voice total (one rounding per day). */
export async function chargeVoice(
  tenantId: string,
  realCostUsd: number,
  actionType: 'voice_transcription' | 'voice_speech',
  model: string,
): Promise<void> {
  if (realCostUsd <= 0) return;
  const day = new Date().toISOString().slice(0, 10);
  const provider = model.startsWith('gemini') ? 'google' : 'openai';
  await chargeTowards(tenantId, { jobId: `voice:${day}` }, realCostUsd, 'chat', actionType, { provider, model })
    .catch(err => console.error(`[voice] ${actionType} charge failed:`, err));
}

/** The speech engines' keys: the customer's own when connected (free to them), otherwise the platform's. */
export async function speechKeys(tenantId: string): Promise<EngineKeys> {
  const own = (provider: string) => readDecryptedToken(tenantId, provider).catch(() => null);
  const [openai, gemini] = await Promise.all([own('openai'), own('gemini')]);
  return {
    openai: openai ? { key: openai, own: true } : process.env.OPENAI_API_KEY ? { key: process.env.OPENAI_API_KEY, own: false } : null,
    gemini: gemini ? { key: gemini, own: true } : process.env.GEMINI_API_KEY ? { key: process.env.GEMINI_API_KEY, own: false } : null,
  };
}
