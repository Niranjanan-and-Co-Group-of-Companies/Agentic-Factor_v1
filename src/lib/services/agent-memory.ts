/**
 * Agent Memory — episodic + profile memory for mission agents.
 *
 * After each chat conversation, writeEpisode() is called (fire-and-forget).
 * It extracts what happened, stores an episode row, and merges any new
 * facts into the agent's profile. Both are injected into the system prompt
 * on the next conversation so the agent never starts from scratch.
 */

import { createServiceClient } from '@/lib/supabase/server';

// ── Types ─────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Episode {
  summary: string;
  tools_used: string[];
  outcomes: string[];
  follow_ups: string[];
}

interface Profile {
  [key: string]: unknown;
}

// ── Episode writing ────────────────────────────────────────────────────────

/**
 * Called after a chat session ends (fire-and-forget).
 * Extracts episode data via a fast LLM call, stores in agent_episodes,
 * and merges new facts into agent_profiles.
 */
export async function writeEpisode(
  tenantId: string,
  missionId: string,
  messages: ChatMessage[],
  toolsUsedInSession: string[]
): Promise<void> {
  if (messages.length < 2) return; // Nothing meaningful to store

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return;

  try {
    const transcript = messages
      .slice(-20) // last 20 messages — enough context without bloat
      .map(m => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content.slice(0, 800)}`)
      .join('\n');

    const prompt = `Extract a structured memory summary from this agent conversation.

CONVERSATION:
${transcript}

Return ONLY valid JSON in this exact shape (no markdown, no explanation):
{
  "summary": "2-3 sentence plain-English summary of what was discussed and accomplished",
  "outcomes": ["specific thing accomplished 1", "specific thing accomplished 2"],
  "follow_ups": ["pending item or next step 1"],
  "new_profile_facts": {
    "key": "value"
  }
}

Rules:
- summary: what the customer asked, what the agent did
- outcomes: concrete completed actions (bookings, emails sent, data fetched, etc.)
- follow_ups: things mentioned but not yet done, or items to check next time
- new_profile_facts: NEW facts learned about the customer (goals, preferences, constraints, history). Only include facts that would be useful in future conversations. Use simple keys like "fitness_goal", "preferred_time", "dietary_restriction", "company_name", etc. Empty object {} if nothing new was learned.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // fast + cheap for memory extraction
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.error('[agent-memory] LLM extraction failed:', res.status);
      return;
    }

    const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
    const raw = data.content?.find(b => b.type === 'text')?.text ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const extracted = JSON.parse(jsonMatch[0]) as Episode & { new_profile_facts?: Profile };
    const supabase = createServiceClient();

    // ── Store episode ──────────────────────────────────────────────────
    const { error: episodeErr } = await supabase.from('agent_episodes').insert({
      tenant_id: tenantId,
      mission_id: missionId,
      summary: (extracted.summary ?? '').slice(0, 2000),
      tools_used: [...new Set([...(extracted.tools_used ?? []), ...toolsUsedInSession])],
      outcomes: (extracted.outcomes ?? []).slice(0, 10),
      follow_ups: (extracted.follow_ups ?? []).slice(0, 5),
    });

    if (episodeErr) console.error('[agent-memory] Episode insert error:', episodeErr);

    // ── Merge new facts into profile ───────────────────────────────────
    const newFacts = extracted.new_profile_facts ?? {};
    if (Object.keys(newFacts).length > 0) {
      await mergeProfileFacts(supabase, tenantId, missionId, newFacts);
    }
  } catch (err) {
    console.error('[agent-memory] writeEpisode error:', err);
  }
}

async function mergeProfileFacts(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  missionId: string,
  newFacts: Profile
): Promise<void> {
  try {
    // Get existing profile
    const { data: existing } = await supabase
      .from('agent_profiles')
      .select('profile_data')
      .eq('tenant_id', tenantId)
      .eq('mission_id', missionId)
      .maybeSingle();

    const currentData = (existing?.profile_data as Profile) ?? {};
    // Merge: new facts overwrite old ones for the same key
    const merged = { ...currentData, ...newFacts };

    await supabase
      .from('agent_profiles')
      .upsert(
        { tenant_id: tenantId, mission_id: missionId, profile_data: merged, updated_at: new Date().toISOString() },
        { onConflict: 'tenant_id,mission_id' }
      );
  } catch (err) {
    console.error('[agent-memory] mergeProfileFacts error:', err);
  }
}

// ── Memory retrieval ───────────────────────────────────────────────────────

export interface MemoryContext {
  profileBlock: string | null;
  episodesBlock: string | null;
}

/**
 * Retrieve agent profile + recent episodes formatted for system prompt injection.
 */
export async function getMemoryContext(
  tenantId: string,
  missionId: string
): Promise<MemoryContext> {
  const supabase = createServiceClient();
  let profileBlock: string | null = null;
  let episodesBlock: string | null = null;

  // ── Profile ──────────────────────────────────────────────────────────
  try {
    const { data: profile } = await supabase
      .from('agent_profiles')
      .select('profile_data, updated_at')
      .eq('tenant_id', tenantId)
      .eq('mission_id', missionId)
      .maybeSingle();

    if (profile?.profile_data && Object.keys(profile.profile_data as Profile).length > 0) {
      const facts = Object.entries(profile.profile_data as Profile)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `  • ${k.replace(/_/g, ' ')}: ${String(v)}`)
        .join('\n');
      if (facts) {
        profileBlock = `═══ WHAT I KNOW ABOUT THIS CUSTOMER ═══\n${facts}`;
      }
    }
  } catch { /* non-fatal */ }

  // ── Recent episodes ──────────────────────────────────────────────────
  try {
    const { data: episodes } = await supabase
      .from('agent_episodes')
      .select('summary, outcomes, follow_ups, tools_used, created_at')
      .eq('tenant_id', tenantId)
      .eq('mission_id', missionId)
      .order('created_at', { ascending: false })
      .limit(3);

    if (episodes && episodes.length > 0) {
      const lines: string[] = ['═══ RECENT SESSIONS ═══'];
      for (const ep of episodes) {
        const when = formatRelativeDate(new Date(ep.created_at));
        lines.push(`\n[${when}] ${ep.summary}`);
        if (ep.outcomes?.length > 0) {
          lines.push(`  Done: ${ep.outcomes.join(' · ')}`);
        }
        if (ep.follow_ups?.length > 0) {
          lines.push(`  Pending: ${ep.follow_ups.join(' · ')}`);
        }
      }
      episodesBlock = lines.join('\n');
    }
  } catch { /* non-fatal */ }

  return { profileBlock, episodesBlock };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeDate(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
