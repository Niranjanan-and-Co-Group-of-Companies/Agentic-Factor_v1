import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// Static pool — always available as fallback before first cron run or if DB is empty.
// Covers every life and business area: sales, marketing, operations, personal productivity,
// customer retention & acquisition, research, study, health, finance, HR, e-commerce, legal,
// real estate, social media, events, education, journalism, non-profit, and more.
const STATIC_MESSAGES = [
  // ── Sales & Revenue ──
  "Companies running AI-powered sales follow-up report 3× more deals closed — without adding a single hire.",
  "AI agent teams that follow up with every lead within 60 seconds convert 391% more than teams that wait an hour.",
  "What if your best salesperson never had an off day, never forgot a follow-up, and could handle 200 prospects simultaneously?",
  "Sales teams using AI agents to personalise outreach report 47% higher reply rates and 2× pipeline velocity.",
  "Your agents qualify, nurture, and hand off warm leads to you — you just close. The pipeline never sleeps.",

  // ── Marketing & Content ──
  "Early adopters of AI agent automation report 40% lower marketing spend with 2× the output.",
  "Brands running automated email workflows see 45% higher open rates and 3× better reply rates than manual campaigns.",
  "Teams using AI automation report 60% reduction in manual marketing effort while increasing campaign volume by 3×.",
  "Your content agent writes, schedules, and posts across every channel while you focus on the strategy that only you can set.",
  "AI-powered content teams produce 5× more output at one-third the cost — and the quality keeps improving every cycle.",
  "One agent. Every platform. Consistent brand voice 24 hours a day — no briefings, no delays, no missed posts.",

  // ── Operations & Admin ──
  "Teams automating their reporting workflows recover an average of 9 hours a week, every single week.",
  "AI agent workflows reduce average project coordination time by 52% — more done, fewer meetings, zero dropped balls.",
  "Your agents don't take lunch breaks, don't miss emails, and don't forget to follow up. They just work.",
  "Every hour your agents work costs a fraction of a human hour — and every insight they surface was invisible before.",
  "The difference between a 7-figure and 8-figure business? Usually systems. Your agents are your systems.",
  "Businesses that automate their reporting and analytics save an average of 8 hours per week in manual data work.",
  "Automation isn't about replacing people — it's about making every person on your team 10× more effective.",
  "Routine operations running on autopilot means your team can focus entirely on work that moves the needle.",

  // ── Customer Retention ──
  "AI agent teams that handle routine communication reduce customer churn by up to 23% through consistency alone.",
  "Businesses using always-on AI agents report 35% improvement in customer satisfaction through faster, more consistent responses.",
  "Customers who receive proactive check-ins are 4× more likely to renew — your retention agent never misses a touchpoint.",
  "Automated customer health monitoring catches warning signs weeks before a cancellation — agents reach out before the problem grows.",
  "Personalised re-engagement sequences run by AI agents recover an average of 18% of customers who had gone silent.",
  "Your retention agent tracks usage, flags drop-offs, and sends the right message at the right moment — automatically.",

  // ── Customer Acquisition ──
  "AI-powered lead qualification reduces time-to-first-contact from hours to seconds, capturing opportunities others miss.",
  "Companies deploying AI agent workflows close 28% more deals by ensuring every lead is followed up within the first hour.",
  "A single AI agent can research, personalise, and send outreach to 500 prospects in the time it takes to have a coffee.",
  "Your acquisition agent finds, qualifies, and warms up your ideal customer profile — while you work on everything else.",
  "Businesses using AI for prospecting research report 60% less time spent on manual research per qualified lead.",
  "While you sleep, your agents are identifying new prospects, scraping signals, and building your pipeline for tomorrow.",

  // ── Research & Academia ──
  "Research agents can scan 500 papers, extract key findings, and compile a literature summary in under 10 minutes.",
  "PhD students using AI research agents report spending 70% less time on literature reviews and 70% more time on original thinking.",
  "Your research agent tracks new publications, flags relevant studies, and keeps your knowledge base current — automatically.",
  "Give your research agent a topic and come back to a structured summary with citations, gaps, and key debates identified.",
  "AI agents are helping academics produce 3× more grant proposals by handling background research and formatting — not the ideas.",
  "A research synthesis that used to take 3 weeks of manual reading can now be completed by an agent in an afternoon.",

  // ── Study & Learning ──
  "Students using AI study agents report 40% faster revision cycles and significantly higher recall in practice tests.",
  "Your study agent turns any textbook chapter into flashcards, summaries, and practice questions — ready before your next session.",
  "AI learning agents adapt to your pace, identify your weak areas, and schedule spaced repetition automatically.",
  "Imagine having a personal tutor that's always available, infinitely patient, and prepared for exactly your exam syllabus.",
  "Study agents summarise lectures, highlight key concepts, and generate mock papers — so you spend time learning, not organising.",
  "With an AI study agent, an hour of focused learning covers what used to take an entire day of scattered reading.",

  // ── Personal Productivity ──
  "The average person spends 28% of their workday managing email. An AI agent can handle triage, drafting, and follow-ups.",
  "Your personal productivity agent manages your calendar, flags priorities, and drafts responses — before you even ask.",
  "People using AI agents for personal task management report completing 35% more high-priority work each week.",
  "Imagine starting every morning with a briefing: what's urgent, what's done, what needs your decision. Your agent builds that for you.",
  "AI agents take the cognitive load of remembering, scheduling, and chasing off your plate — so your focus stays on what matters.",
  "Your time is finite. Your agent's capacity isn't. Let it handle the logistics so you can do the work only you can do.",

  // ── Health & Fitness ──
  "Fitness coaches using AI agents to send personalised check-ins report 3× better client adherence to programs.",
  "Your health tracking agent monitors patterns across your data and surfaces insights before symptoms become problems.",
  "AI agents help wellness businesses onboard 5× more clients without increasing coach workload by automating progress tracking.",
  "A nutrition agent that plans meals, generates shopping lists, and tracks macros costs less than a single consultation.",
  "Personal trainers using AI for client communication spend 6 fewer hours a week on admin — and retain clients longer.",

  // ── Finance & Accounting ──
  "Businesses using AI agents for bookkeeping reconciliation reduce month-end close time by 65% on average.",
  "Your finance agent monitors cash flow, flags anomalies, and sends weekly summaries — so surprises stay off the balance sheet.",
  "AI-powered expense categorisation and invoice processing reduces accounting labour costs by up to 50%.",
  "Financial advisors using AI research agents serve 40% more clients without compromising the depth of their analysis.",
  "Your agent tracks every invoice, payment, and outstanding receivable — and follows up automatically so you don't have to.",

  // ── HR & Recruitment ──
  "Recruiters using AI agents to screen and shortlist CVs reduce time-to-interview by 70% without sacrificing quality.",
  "Your HR agent sends onboarding sequences, collects documents, and answers new-hire questions — before day one even starts.",
  "AI-powered job description optimisation increases qualified applicant volume by 38% on average.",
  "Employee engagement agents that send regular pulse checks and act on the data reduce voluntary turnover by 21%.",
  "Automate the routine parts of recruitment — screening, scheduling, follow-ups — so your team focuses on the human moments.",

  // ── E-commerce & Retail ──
  "E-commerce brands using AI agents for abandoned cart recovery report recovering 15–22% of otherwise lost revenue.",
  "Your product description agent writes SEO-optimised listings for 1,000 SKUs in the time it takes to manually write 10.",
  "AI inventory monitoring agents flag reorder points, predict stockouts, and generate purchase orders automatically.",
  "Customer service agents that resolve 70% of queries without human intervention allow your team to focus on complex cases.",
  "Personalised product recommendation agents increase average order value by 26% across e-commerce deployments.",

  // ── Real Estate ──
  "Real estate agents using AI for lead nurturing close 31% more deals by staying top-of-mind with every prospect.",
  "Your property research agent compares listings, pulls comparable sales, and drafts market summaries in minutes.",
  "AI agents send automated showing follow-ups, gather buyer feedback, and keep sellers informed — without any manual work.",
  "Property management agents that handle tenant communication, maintenance requests, and reminders free up hours every day.",

  // ── Social Media & Community ──
  "Social media managers using AI agents to schedule and repurpose content save an average of 12 hours per week.",
  "Your community agent monitors mentions, flags conversations needing attention, and drafts responses before you ask.",
  "Brands using AI for social listening respond to customer mentions 8× faster — and reputation scores reflect it.",
  "An AI agent turns one long-form piece of content into 15 platform-specific posts, stories, and threads automatically.",

  // ── Legal & Compliance ──
  "Legal teams using AI research agents reduce time spent on case precedent research by 60% without reducing thoroughness.",
  "Compliance monitoring agents flag regulatory changes relevant to your business the day they're published.",
  "Your contract review agent identifies non-standard clauses, missing provisions, and risk flags before you sign anything.",
  "Law firms using AI for document drafting and review handle 40% more matters with the same number of fee earners.",

  // ── Events & Hospitality ──
  "Event coordinators using AI agents for vendor follow-up and guest communication save 8+ hours per event.",
  "Your event agent tracks RSVPs, sends reminders, coordinates logistics, and compiles feedback — end to end.",
  "Hotels using AI concierge agents report 28% higher guest satisfaction scores and 20% more upsell conversions.",

  // ── Education & Coaching ──
  "Coaches who automate session prep, follow-ups, and resource sharing serve 3× more clients without burning out.",
  "Online course creators using AI agents for student engagement see 45% better course completion rates.",
  "Your coaching agent sends personalised homework, tracks progress, and identifies students who need extra attention.",
  "EdTech platforms using AI to personalise learning paths report 52% better outcome scores compared to one-size-fits-all content.",

  // ── Journalism & Media ──
  "Journalists using AI research agents produce first drafts 4× faster — spending more time on interviews and less on background.",
  "Your media monitoring agent tracks every mention of your topic across thousands of sources in real time.",
  "AI agents that automate newsletter curation and distribution let media teams publish daily without daily manual effort.",

  // ── Non-profit & Social Impact ──
  "Non-profits using AI agents for donor follow-up report 34% higher donation retention year over year.",
  "Your grant research agent identifies relevant funding opportunities and prepares draft applications — maximising every pound of effort.",
  "AI agents helping charities automate volunteer coordination report 50% fewer scheduling conflicts and higher satisfaction.",

  // ── Universal / Philosophy ──
  "Give your agents a mission and the permission to act. They handle the execution, every hour, without interruption.",
  "You set the direction, approve the actions, and capture the results. Your agents handle everything in between.",
  "The companies winning the next decade won't have more people — they'll have better-deployed agents working around the clock.",
  "Your agents remember everything, follow up every time, and never drop the ball. That's not a tool — that's infrastructure.",
  "Give the approval once. Your agents execute it a thousand times — perfectly, consistently, at scale.",
  "While you sleep, your agents are reading emails, qualifying leads, and updating records. The work never stops.",
  "The average founder spends 22 hours a week on tasks that can be automated. Your agents can give those hours back.",
  "What takes a human team a week takes your agents an afternoon. What takes an afternoon takes minutes.",
  "Your competitors are still doing this manually. Give your agents the go-ahead and pull ahead today.",
  "The ROI on AI automation isn't measured in weeks — it's measured in the hours you get back starting today.",
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
