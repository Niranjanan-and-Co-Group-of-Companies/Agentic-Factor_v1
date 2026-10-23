// Voice in the chat — speech to text and replies read aloud — billed like chat: real cost × 3.
// A day's voice use is rounded up once (a 10-second message is a fraction of a credit), and nothing is
// charged when the customer's own OpenAI key paid for it.

import { chargeTowards } from '@/lib/middleware/billing';

/** Charges a voice cost towards the day's voice total (one rounding per day). */
export async function chargeVoice(
  tenantId: string,
  realCostUsd: number,
  actionType: 'voice_transcription' | 'voice_speech',
  model: string,
): Promise<void> {
  if (realCostUsd <= 0) return;
  const day = new Date().toISOString().slice(0, 10);
  await chargeTowards(tenantId, { jobId: `voice:${day}` }, realCostUsd, 'chat', actionType, { provider: 'openai', model })
    .catch(err => console.error(`[voice] ${actionType} charge failed:`, err));
}
