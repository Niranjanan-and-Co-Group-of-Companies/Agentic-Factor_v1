import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendEmail, ADMIN_EMAIL } from '@/lib/services/email-notifications';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Get all active models
  const { data: models, error } = await supabase
    .from('llm_models')
    .select('id, provider, model_name, display_name, tier, failure_count, health_status')
    .eq('is_active', true);

  if (error || !models?.length) {
    return NextResponse.json({ checked: 0, message: 'No models to check or table not found' });
  }

  // Deduplicate by provider+model_name (same model may appear in multiple tiers)
  const unique = new Map<string, typeof models[0]>();
  for (const m of models) {
    const key = `${m.provider}:${m.model_name}`;
    if (!unique.has(key)) unique.set(key, m);
  }

  let healthy = 0;
  let down = 0;
  const results: { model: string; provider: string; status: string }[] = [];
  // Only the models that just crossed INTO 'down' this run — not ones that
  // were already down last check. Without this, an alert would fire on
  // every single cron tick (every 30 minutes) for as long as a provider
  // stays down, instead of once when it actually breaks.
  const newlyDown: { model: string; provider: string }[] = [];

  for (const [, model] of unique) {
    try {
      const ok = await pingModel(model.provider, model.model_name);
      if (ok) {
        // Mark healthy + reset failure count for ALL tiers of this model
        await supabase
          .from('llm_models')
          .update({ health_status: 'healthy', failure_count: 0, last_health_check: new Date().toISOString() })
          .eq('provider', model.provider)
          .eq('model_name', model.model_name);
        healthy++;
        results.push({ model: model.model_name, provider: model.provider, status: 'healthy' });
      } else {
        throw new Error('Ping returned false');
      }
    } catch (err) {
      const newFailCount = (model.failure_count || 0) + 1;
      const newStatus = newFailCount >= 3 ? 'down' : 'degraded';

      await supabase
        .from('llm_models')
        .update({ health_status: newStatus, failure_count: newFailCount, last_health_check: new Date().toISOString() })
        .eq('provider', model.provider)
        .eq('model_name', model.model_name);

      down++;
      results.push({ model: model.model_name, provider: model.provider, status: newStatus });
      console.warn(`[HealthCheck] ${model.provider}/${model.model_name} failed: ${(err as Error).message}`);

      if (newStatus === 'down' && model.health_status !== 'down') {
        newlyDown.push({ model: model.model_name, provider: model.provider });
      }
    }
  }

  if (newlyDown.length > 0) {
    console.error(`[HealthCheck] ${newlyDown.length} model(s) just went down: ${newlyDown.map(m => `${m.provider}/${m.model}`).join(', ')}`);
    try {
      const listHtml = newlyDown.map(m => `<li><strong>${m.provider}/${m.model}</strong></li>`).join('');
      const listText = newlyDown.map(m => `- ${m.provider}/${m.model}`).join('\n');
      await sendEmail({
        to: ADMIN_EMAIL,
        subject: `🔴 LLM Provider Down: ${newlyDown.map(m => m.provider).join(', ')}`,
        htmlBody: `
          <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ef4444;">🔴 LLM Provider Health Alert</h2>
            <p>The following model(s) failed 3 consecutive health checks and are now marked <strong>down</strong>:</p>
            <ul>${listHtml}</ul>
            <p style="margin-top: 24px; color: #64748b;">callLLM() should still cascade to the remaining healthy providers automatically, but missions relying exclusively on a down provider/tier may fail until it recovers.</p>
          </div>
        `,
        textBody: `LLM Provider Health Alert\n\nThe following model(s) failed 3 consecutive health checks and are now marked down:\n${listText}\n\ncallLLM() should still cascade to the remaining healthy providers automatically, but missions relying exclusively on a down provider/tier may fail until it recovers.`,
      });
    } catch (emailErr) {
      console.error('[HealthCheck] Failed to send admin alert email (non-fatal):', emailErr);
    }
  }

  return NextResponse.json({ checked: unique.size, healthy, down, newlyDown: newlyDown.length, results });
}

async function pingModel(provider: string, modelName: string): Promise<boolean> {
  const PING_PROMPT = 'Respond with exactly: ok';
  const TIMEOUT_MS = 15000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    if (provider === 'google' && process.env.GEMINI_API_KEY) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: PING_PROMPT }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
          signal: controller.signal,
        }
      );
      return res.ok;
    }

    if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 10,
          messages: [{ role: 'user', content: PING_PROMPT }],
        }),
        signal: controller.signal,
      });
      return res.ok;
    }

    if (provider === 'openai' && process.env.OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 10,
          messages: [{ role: 'user', content: PING_PROMPT }],
        }),
        signal: controller.signal,
      });
      return res.ok;
    }

    return false; // No API key for this provider
  } finally {
    clearTimeout(timeout);
  }
}
