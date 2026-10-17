import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 60;

/**
 * Daily: compares what Anthropic actually billed us yesterday (its Cost API) with the real cost we
 * recorded on our customers' charges, and emails the admin when we billed noticeably less than we spent
 * — a price that changed, or usage that isn't being charged. Needs ANTHROPIC_ADMIN_KEY (an Admin API
 * key from the Claude Console; organisations only); without it, it does nothing.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  if (!adminKey) return NextResponse.json({ skipped: 'ANTHROPIC_ADMIN_KEY is not set' });

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - 24 * 60 * 60_000);

  // What Anthropic billed (amounts are decimal strings in cents).
  let anthropicUsd = 0;
  let page: string | undefined;
  do {
    const url = new URL('https://api.anthropic.com/v1/organizations/cost_report');
    url.searchParams.set('starting_at', start.toISOString());
    url.searchParams.set('ending_at', end.toISOString());
    url.searchParams.set('bucket_width', '1d');
    if (page) url.searchParams.set('page', page);
    const res = await fetch(url, { headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' } });
    if (!res.ok) return NextResponse.json({ error: `Cost API ${res.status}: ${(await res.text()).slice(0, 300)}` }, { status: 502 });
    const body = await res.json() as { data?: Array<{ results?: Array<{ amount?: string; currency?: string }> }>; has_more?: boolean; next_page?: string };
    for (const bucket of body.data ?? []) {
      for (const r of bucket.results ?? []) anthropicUsd += (Number(r.amount) || 0) / 100;
    }
    page = body.has_more ? body.next_page : undefined;
  } while (page);

  // What we recorded on customers' charges for Claude calls in the same window.
  const supabase = createServiceClient();
  let recordedUsd = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('events').select('payload')
      .eq('event_type', 'billing.credit_used')
      .gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of data ?? []) {
      const p = row.payload as { model?: string; realCostUsd?: number };
      if (typeof p.realCostUsd === 'number' && /claude/i.test(p.model ?? '')) recordedUsd += p.realCostUsd;
    }
    if (!data || data.length < 1000) break;
  }

  const coverage = anthropicUsd > 0 ? recordedUsd / anthropicUsd : 1;
  const day = start.toISOString().slice(0, 10);
  await supabase.from('events').insert({
    event_type: 'billing.cost_check', entity_type: 'system',
    payload: { day, anthropicUsd: +anthropicUsd.toFixed(4), recordedUsd: +recordedUsd.toFixed(4), coverage: +coverage.toFixed(3) },
  });

  // Under 80% means a fifth of what we spent was never billed to anyone.
  if (anthropicUsd >= 1 && coverage < 0.8) {
    const { sendEmail, ADMIN_EMAIL } = await import('@/lib/services/email-notifications');
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `⚠️ Claude spend not fully billed on ${day}: $${anthropicUsd.toFixed(2)} spent, $${recordedUsd.toFixed(2)} billed`,
      htmlBody: `<div style="font-family: Inter, sans-serif; max-width: 600px;"><h2>Claude spend vs what we billed</h2><p>On ${day} Anthropic billed us <b>$${anthropicUsd.toFixed(2)}</b>, but our customers' charges recorded a real cost of only <b>$${recordedUsd.toFixed(2)}</b> (${Math.round(coverage * 100)}%).</p><p>Either a price in <code>src/lib/services/prices.ts</code> is out of date, or some calls are not being charged.</p></div>`,
    }).catch(() => {});
  }

  return NextResponse.json({ day, anthropicUsd, recordedUsd, coverage });
}
