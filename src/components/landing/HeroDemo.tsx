"use client";
import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, MessageSquareText, ShieldCheck, Clock } from "lucide-react";
import { AppTile, type BrandKey } from "./brandIcons";
import s from "./landing.module.css";

type Agent = { brand: BrandKey | "af"; task: string; app: string };
type Scenario = { label: string; ask: string; agents: Agent[]; action: string; detail: string; result: string; bars: number[] };

// Every scenario has five agents so the card keeps one height as it cycles.
const SCENARIOS: Scenario[] = [
  {
    label: "Sales",
    ask: "Every Monday, pull last week's sales by region from Zoho Books, write a one-page report in Google Docs, turn it into a 5-slide deck in Canva, and email both to the leadership team.",
    agents: [
      { brand: "zoho", task: "Read last week's invoices and payments", app: "Zoho Books" },
      { brand: "sheets", task: "Build the regional summary and charts", app: "Google Sheets" },
      { brand: "docs", task: "Write a one-page report on what changed", app: "Google Docs" },
      { brand: "canva", task: "Design a 5-slide deck from the report", app: "Canva" },
      { brand: "gmail", task: "Email both to the leadership team", app: "Gmail" },
    ],
    action: "Send 1 email to 4 people",
    detail: "“Weekly sales pack” · report and deck links",
    result: "Done in 2m 10s · repeats Mondays, 9:00 am",
    bars: [7, 11, 9, 15, 12, 19, 16],
  },
  {
    label: "Leads",
    ask: "When someone fills our website form, add them to HubSpot, score the lead, and email a personal welcome with a link to book a call.",
    agents: [
      { brand: "typeform", task: "Watch for new form entries", app: "Typeform" },
      { brand: "hubspot", task: "Create or update the contact", app: "HubSpot" },
      { brand: "af", task: "Score the lead and pick an owner", app: "Agentic Factor" },
      { brand: "calendly", task: "Create a personal booking link", app: "Calendly" },
      { brand: "gmail", task: "Send the welcome with the link", app: "Gmail" },
    ],
    action: "Send 1 email",
    detail: "to the new lead · “Welcome — book a 15-minute call”",
    result: "Live · runs on every new entry",
    bars: [5, 8, 12, 10, 14, 17, 21],
  },
  {
    label: "Store",
    ask: "Each evening, match today's Shopify orders with Razorpay payments, flag low-stock items, log totals to our daily sheet, and post a summary to the team on WhatsApp.",
    agents: [
      { brand: "shopify", task: "Read today's orders and stock levels", app: "Shopify" },
      { brand: "razorpay", task: "Match payments and flag mismatches", app: "Razorpay" },
      { brand: "sheets", task: "Log totals to the daily sheet", app: "Google Sheets" },
      { brand: "trello", task: "Create restock cards for low items", app: "Trello" },
      { brand: "whatsapp", task: "Post the evening summary", app: "WhatsApp" },
    ],
    action: "Post 1 message · create 2 Trello cards",
    detail: "to Ops team · “38 orders · ₹1,24,500 · 2 items low”",
    result: "Done in 52s · repeats daily, 8:00 pm",
    bars: [9, 7, 12, 16, 13, 18, 22],
  },
  {
    label: "Month-end",
    ask: "On the 1st, reconcile last month's Razorpay settlements with our Zoho Books invoices, record the payments, chase overdue invoices, and send me a close summary.",
    agents: [
      { brand: "razorpay", task: "Read last month's settlements", app: "Razorpay" },
      { brand: "zoho", task: "Match them to open invoices", app: "Zoho Books" },
      { brand: "zoho", task: "Record the matched payments", app: "Zoho Books" },
      { brand: "gmail", task: "Draft reminders for overdue invoices", app: "Gmail" },
      { brand: "sheets", task: "Write the close summary", app: "Google Sheets" },
    ],
    action: "Record 42 payments · send 5 reminders",
    detail: "₹18,40,000 matched · 3 held for your review",
    result: "Done in 3m 05s · repeats on the 1st, 10:00 am",
    bars: [6, 9, 14, 11, 17, 15, 20],
  },
  {
    label: "Hiring",
    ask: "When applications reach our careers inbox, shortlist them against the criteria I set, invite the top candidates to a Zoom interview, and update our hiring tracker in Notion.",
    agents: [
      { brand: "gmail", task: "Read new applications and CVs", app: "Gmail" },
      { brand: "af", task: "Score each one against your criteria", app: "Agentic Factor" },
      { brand: "calendar", task: "Find free interview slots", app: "Google Calendar" },
      { brand: "zoom", task: "Create the meeting links", app: "Zoom" },
      { brand: "notion", task: "Update the hiring tracker", app: "Notion" },
    ],
    action: "Send 3 interview invitations",
    detail: "Thu–Fri slots · Zoom links attached",
    result: "Live · runs on every new application",
    bars: [4, 9, 7, 13, 11, 16, 18],
  },
];

type RowStatus = "hidden" | "wait" | "run" | "done";
interface Frame { typed: number; rows: RowStatus[]; approval: boolean; pressed: boolean; approved: boolean; result: boolean; leaving: boolean }
type Step = [ms: number, change: (f: Frame) => Partial<Frame>];

const finished = (sc: Scenario): Frame => ({ typed: sc.ask.length, rows: sc.agents.map(() => "done"), approval: true, pressed: false, approved: true, result: true, leaving: false });
const blank = (f: { rows: unknown[] }): Frame => ({ typed: 0, rows: f.rows.map(() => "hidden"), approval: false, pressed: false, approved: false, result: false, leaving: false });
const empty = (sc: Scenario): Frame => blank({ rows: sc.agents });
const setRow = (i: number, st: RowStatus) => (f: Frame) => { const rows = [...f.rows]; rows[i] = st; return { rows }; };

/** One scenario's animation: what changes when, and when it hands over to the next. */
function timeline(sc: Scenario): { steps: Step[]; leave: number } {
  const steps: Step[] = [];
  const n = sc.agents.length;
  let t = 320;
  // Type the request a little unevenly, like a person — quick enough for long requests.
  for (let c = 1; c <= sc.ask.length; c++) {
    t += 13 + (sc.ask[c - 1] === " " ? 16 : 0) + ((c * 7) % 9);
    const k = c;
    steps.push([t, () => ({ typed: k })]);
  }
  t += 480;
  for (let i = 0; i < n; i++) { steps.push([t + i * 280, setRow(i, "wait")], [t + i * 280 + 220, setRow(i, "run")]); }
  t += n * 280 + 850;
  for (let i = 0; i < n; i++) steps.push([t + i * 300, setRow(i, "done")]);
  t += n * 300 + 380;
  steps.push([t, () => ({ approval: true })]);
  t += 1600;
  steps.push([t, () => ({ pressed: true })]);
  t += 200;
  steps.push([t, () => ({ pressed: false, approved: true })]);
  t += 460;
  steps.push([t, () => ({ result: true })]);
  t += 3000;
  steps.push([t, () => ({ leaving: true })]);
  return { steps, leave: t };
}

export default function HeroDemo() {
  const [index, setIndex] = useState(0);
  const [played, setPlayed] = useState<Frame>(() => empty(SCENARIOS[0])); // the animation's progress while it plays
  const [active, setActive] = useState(false);
  const [run, setRun] = useState(0); // bumps when a visitor picks a mission, restarting its sequence
  const rootRef = useRef<HTMLDivElement>(null);

  // Animate only while visible and when the visitor hasn't asked for reduced motion.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !rootRef.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      setActive(e.isIntersecting);
      if (!e.isIntersecting) setPlayed(f => ({ ...f, ...blank(f) })); // start clean when it comes back into view
    }, { threshold: 0.25 });
    io.observe(rootRef.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return;
    const sc = SCENARIOS[index];
    const { steps, leave } = timeline(sc);
    const timers = [setTimeout(() => setPlayed(empty(sc)), 0)];
    for (const [ms, change] of steps) timers.push(setTimeout(() => setPlayed(f => ({ ...f, ...change(f) })), ms));
    timers.push(setTimeout(() => setIndex(i => (i + 1) % SCENARIOS.length), leave + 460));
    return () => timers.forEach(clearTimeout);
  }, [index, active, run]);

  const pick = (i: number) => { setPlayed(empty(SCENARIOS[i])); setIndex(i); setRun(r => r + 1); };
  const sc = SCENARIOS[index];
  // Off-screen or with reduced motion, show the mission finished.
  const frame = active ? played : finished(sc);
  const typing = frame.typed < sc.ask.length;

  return (
    <div ref={rootRef} className={s.demo} role="region" aria-label="Example missions">
      <div className={s.demoHead}>
        <span className={s.demoLabel}><MessageSquareText size={14} strokeWidth={1.75} aria-hidden /> Command Center</span>
        <span className={s.demoLive}><span className={s.demoDot} aria-hidden /> Live</span>
      </div>
      <p className={s.srOnly}>{`Example: “${sc.ask}” — ${sc.agents.length} agents, then your approval to ${sc.action.toLowerCase()}.`}</p>
      <div className={`${s.demoBody} ${frame.leaving ? s.demoBodyOut : ""}`} aria-hidden>
        <div>
          <div className={s.demoKicker}>You asked</div>
          <div className={s.demoInput}>
            <span>{sc.ask.slice(0, frame.typed)}{typing && <span className={s.caret} />}</span>
          </div>
        </div>

        <div>
          <div className={s.demoKicker}>Mission plan · {sc.agents.length} agents</div>
          <div className={s.planList}>
            {sc.agents.map((a, i) => {
              const st = frame.rows[i];
              return (
                <div key={`${index}-${i}`} className={`${s.agentRow} ${st !== "hidden" ? s.agentRowIn : ""}`}>
                  <AppTile brand={a.brand} className={s.agentTile} />
                  <span className={s.agentText}>{a.task}<span className={s.agentApp}>{a.app}</span></span>
                  {st === "run" ? (
                    <span className={`${s.status} ${s.statusRun}`}><LoaderCircle size={11} strokeWidth={2.2} className={s.spin} /><span className={s.statusLabel}>Rehearsing</span></span>
                  ) : st === "done" ? (
                    <span className={`${s.status} ${s.statusDone}`}><Check size={11} strokeWidth={2.4} /><span className={s.statusLabel}>Ready</span></span>
                  ) : (
                    <span className={`${s.status} ${s.statusWait}`}><span className={s.statusLabel}>Queued</span></span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className={`${s.approval} ${frame.approval ? s.approvalIn : ""}`}>
          <div className={s.approvalTop}><ShieldCheck size={15} strokeWidth={1.9} /> {frame.approved ? "Approved by you" : "Waiting for your approval"}</div>
          <div className={s.approvalLine}>{sc.action}</div>
          <div className={s.approvalDetail}>{sc.detail}</div>
          <div className={s.approvalBtns}>
            <span className={`${s.approveBtn} ${frame.pressed ? s.approvePressed : ""} ${frame.approved ? s.approveDone : ""}`}>
              {frame.approved ? <><Check size={13} strokeWidth={2.4} /> Approved</> : "Approve"}
            </span>
            <span className={s.reviewBtn}>Review</span>
          </div>
        </div>

        <div className={`${s.result} ${frame.result ? s.resultIn : ""}`}>
          <span className={s.resultText}><Clock size={15} strokeWidth={2} /> {sc.result}</span>
          <span className={s.bars} aria-hidden>
            {sc.bars.map((h, i) => <span key={i} style={{ height: h, transitionDelay: `${i * 60}ms` }} />)}
          </span>
        </div>
      </div>
      <div className={s.scenarioTabs} role="group" aria-label="Example missions">
        {SCENARIOS.map((x, i) => (
          <button key={x.label} type="button" aria-pressed={i === index} className={`${s.scenarioTab} ${i === index ? s.scenarioTabOn : ""}`} onClick={() => pick(i)}>
            {x.label}
            {i === index && active && <span key={`${run}-${index}`} className={s.tabProgress} style={{ animationDuration: `${timeline(x).leave}ms` }} aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  );
}
