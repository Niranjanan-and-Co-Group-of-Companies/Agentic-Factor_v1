import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// Static pool — always available as fallback before first cron run or if DB is empty.
// Covers: ROI, time savings, 24/7 execution, competitive advantage, transformation.
const STATIC_MESSAGES = [
  "Companies running AI-powered sales follow-up report 3× more deals closed — without adding a single hire.",
  "Your agents work 720 hours every month. You work zero on those tasks — just give the approval.",
  "Teams automating their reporting workflows recover an average of 9 hours a week, every single week.",
  "Early adopters of AI agent automation report 40% lower marketing spend with 2× the output.",
  "While you sleep, your agents are reading emails, qualifying leads, and updating records. The work never stops.",
  "AI agent teams process in minutes what used to take your team entire days. That's not efficiency — that's transformation.",
  "Give your agents a mission and the permission to act. They handle the execution, every hour, without interruption.",
  "Businesses using always-on AI agents report 35% improvement in customer satisfaction through faster, more consistent responses.",
  "The average founder spends 22 hours a week on tasks that can be automated. Your agents can give those hours back.",
  "Companies deploying AI agent workflows close 28% more deals by ensuring every lead is followed up within the first hour.",
  "A single AI agent can research, personalise, and send outreach to 500 prospects in the time it takes to have a coffee.",
  "Your competitors are still doing this manually. Give your agents the go-ahead and pull ahead today.",
  "Businesses using AI content and outreach agents report producing 5× more content with the same team size.",
  "The ROI on AI automation isn't measured in weeks — it's measured in the hours you get back starting today.",
  "What if your best team member never forgot to follow up, never had an off day, and could work on 100 leads at once?",
  "AI agent workflows reduce average project coordination time by 52% — more done, fewer meetings, zero dropped balls.",
  "The businesses growing fastest right now have one thing in common: their operations run on autopilot while they focus on growth.",
  "Your agents don't take lunch breaks, don't miss emails, and don't forget to follow up. They just work.",
  "Brands running automated email workflows see 45% higher open rates and 3× better reply rates than manual campaigns.",
  "Every hour your agents work costs a fraction of a human hour — and every insight they surface was invisible before.",
  "The difference between a 7-figure and 8-figure business? Usually systems. Your agents are your systems.",
  "Automation isn't about replacing people — it's about making every person on your team 10× more effective.",
  "AI agent teams that handle routine communication reduce customer churn by up to 23% through consistency alone.",
  "You set the direction, approve the actions, and capture the results. Your agents handle everything in between.",
  "Businesses that automate their reporting and analytics save an average of 8 hours per week in manual data work.",
  "The companies winning the next decade won't have more people — they'll have better-deployed agents working around the clock.",
  "Your agents remember everything, follow up every time, and never drop the ball. That's not a tool — that's infrastructure.",
  "AI-powered lead qualification reduces time-to-first-contact from hours to seconds, capturing opportunities others miss.",
  "Teams using AI automation report 60% reduction in manual marketing effort while increasing campaign volume by 3×.",
  "Give the approval once. Your agents execute it a thousand times — perfectly, consistently, at scale.",
];

export async function GET() {
  let pool: string[] = [];

  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('platform_messages')
      .select('message')
      .order('created_at', { ascending: false })
      .limit(100);

    pool = (data ?? []).map(r => r.message).filter(Boolean);
  } catch {
    // Table may not exist yet — fall through to static pool
  }

  if (pool.length === 0) pool = STATIC_MESSAGES;

  const message = pool[Math.floor(Math.random() * pool.length)];
  return NextResponse.json({ message });
}
