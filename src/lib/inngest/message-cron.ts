import { inngest } from './client';
import { createServiceClient } from '@/lib/supabase/server';

// ═══════════════════════════════════════════════════════════════════════════
// Daily welcome message generator
//
// Runs at 1:30 AM UTC every day. Calls Claude Haiku to produce 25 fresh
// inspiring messages about AI agent ROI and productivity. Stored in
// platform_messages table — Command Center picks a random one on each load.
// Old batches older than 14 days are pruned automatically.
// ═══════════════════════════════════════════════════════════════════════════

const GENERATION_PROMPT = `Generate 30 unique, inspiring one-to-two sentence messages for an AI agent automation platform dashboard. Each message should feel fresh and be drawn from a DIFFERENT real-world scenario. Spread across ALL of these areas — pick different ones each time so the pool stays diverse:

Sales & revenue growth, Marketing & content creation, Operations & admin, Customer retention, Customer acquisition, Research & academia, Study & learning assistance, Personal productivity, Health & fitness coaching, Finance & accounting, HR & recruitment, E-commerce & retail, Real estate, Social media management, Legal & compliance, Events & hospitality, Education & online coaching, Journalism & media, Non-profit & social impact, Travel & logistics, Mental wellness & therapy support, Parenting & family organisation, Career development & job searching, Language learning, Creative writing & storytelling, Photography & videography businesses, Restaurant & food businesses, Healthcare professionals, Interior design & architecture, Software development teams.

Rules:
- Every message must be 1–2 sentences max
- Include a specific realistic metric or statistic in most messages (percentages, time saved, multipliers)
- Tone: warm, confident, empowering — like a brilliant coach who believes in you, not a salesperson
- Always positive — never mention failures, errors, or anything negative
- Make each message feel like it was written for THAT specific industry or person
- Vary the angle: ROI, time savings, 24/7 execution, competitive edge, quality of life, peace of mind, scale, transformation

Style examples:
"PhD students using AI research agents report spending 70% less time on literature reviews — and 70% more time on original thinking."
"Your fitness coaching agent sends personalised check-ins to every client, every day — without you lifting a finger."
"E-commerce brands using AI for abandoned cart recovery report recovering up to 22% of otherwise lost revenue."
"Give the approval once. Your agents execute it a thousand times — perfectly, consistently, at scale."

Return ONLY a valid JSON array of 30 strings. No markdown, no explanation, no keys — raw JSON array only.`;

export const generateWelcomeMessages = inngest.createFunction(
  {
    id: 'generate-welcome-messages',
    name: 'Generate Daily Welcome Messages',
    retries: 2,
    triggers: [{ cron: '30 1 * * *' }], // 1:30 AM UTC daily
  },
  async ({ step }: { step: { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> } }) => {
    await step.run('generate-and-store', async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          messages: [{ role: 'user', content: GENERATION_PROMPT }],
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);

      const data = await res.json() as { content: Array<{ text: string }> };
      const raw = data.content?.[0]?.text?.trim() ?? '[]';

      let messages: string[] = [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          messages = parsed.filter((m): m is string => typeof m === 'string' && m.length > 10);
        }
      } catch {
        console.error('[WelcomeCron] Failed to parse Claude response:', raw.slice(0, 200));
        return;
      }

      if (messages.length === 0) return;

      const supabase = createServiceClient();
      const today = new Date().toISOString().split('T')[0];

      // Prune messages older than 14 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 14);
      await supabase.from('platform_messages').delete().lt('created_at', cutoff.toISOString());

      // Insert today's batch
      await supabase.from('platform_messages').insert(
        messages.map((message, sort_order) => ({ message, batch_date: today, sort_order }))
      );

      console.log(`[WelcomeCron] Stored ${messages.length} messages for ${today}`);
    });
  }
);
