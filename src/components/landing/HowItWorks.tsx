"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, MessageCircleQuestion, ShieldCheck, TriangleAlert, Wrench, CalendarClock } from "lucide-react";
import { AppTile, type BrandKey } from "./brandIcons";
import s from "./landing.module.css";

const STEPS = [
  { title: "Describe it", text: "Type what you need the way you'd brief a colleague. If something important is unclear, it asks — instead of guessing." },
  { title: "It builds the team", text: "An AI architect designs the agents, picks the right apps and actions from more than 1,600, and writes the code each one runs." },
  { title: "It rehearses. You approve.", text: "Every mission first runs as a rehearsal that changes nothing. You see exactly what it will send, create or delete — and approve in one click." },
  { title: "It runs, and fixes itself", text: "On demand or on a schedule. When an app rejects a step, the platform repairs it and remembers the rule for next time." },
];

type LogKind = "ok" | "warn" | "fix" | "next";
interface Mission {
  label: string;
  ask: string;
  question: string;
  plan: { brand: BrandKey | "af"; task: string; app: string }[];
  action: string;
  detail: string;
  check: string;
  log: [LogKind, string][];
}

// The same four steps, shown on three missions of rising complexity.
const MISSIONS: Mission[] = [
  {
    label: "Monthly statements",
    ask: "Every month, export our statements from Zoho Books to Excel and email me the link.",
    question: "should drafts and voided records be included?",
    plan: [
      { brand: "zoho", task: "Read statements from Zoho Books", app: "Zoho Books" },
      { brand: "sheets", task: "Build a formatted workbook", app: "Excel workbook" },
      { brand: "drive", task: "Save it to your Drive", app: "Google Drive" },
      { brand: "gmail", task: "Email you the link", app: "Gmail" },
    ],
    action: "Send 1 email",
    detail: "to you@yourcompany.com · link to “Financial Statements.xlsx”",
    check: "Workbook preview: 9 sheets, totals checked",
    log: [
      ["ok", "Read the period’s reports and transactions"],
      ["warn", "The app rejected one request’s date format"],
      ["fix", "Repaired the step · rule saved for next time"],
      ["ok", "Workbook saved · email sent"],
      ["next", "Next run: 1st of the month, 9:00 am"],
    ],
  },
  {
    label: "Month-end close",
    ask: "On the 1st, match last month’s Razorpay settlements to our Zoho Books invoices, record the payments and chase anything overdue.",
    question: "should partial payments be matched, or held for your review?",
    plan: [
      { brand: "razorpay", task: "Read last month’s settlements", app: "Razorpay" },
      { brand: "zoho", task: "Match them to open invoices", app: "Zoho Books" },
      { brand: "zoho", task: "Record the matched payments", app: "Zoho Books" },
      { brand: "gmail", task: "Remind customers who are overdue", app: "Gmail" },
      { brand: "sheets", task: "Write the close summary", app: "Google Sheets" },
    ],
    action: "Record 42 payments · send 5 reminders",
    detail: "₹18,40,000 matched · 3 partial payments held for you",
    check: "Preview: 42 of 45 settlements matched to the rupee",
    log: [
      ["ok", "Read 45 settlements from Razorpay"],
      ["warn", "Zoho Books rejected a payment without a deposit account"],
      ["fix", "Repaired: added the bank account · rule saved"],
      ["ok", "42 payments recorded · 5 reminders sent"],
      ["next", "Next close: 1st of next month, 10:00 am"],
    ],
  },
  {
    label: "Hiring pipeline",
    ask: "When applications reach our careers inbox, shortlist them against my criteria, invite the best to a Zoom interview and update our Notion tracker.",
    question: "how many candidates should be invited each week?",
    plan: [
      { brand: "gmail", task: "Read new applications and CVs", app: "Gmail" },
      { brand: "af", task: "Score each one against your criteria", app: "Agentic Factor" },
      { brand: "calendar", task: "Find free interview slots", app: "Google Calendar" },
      { brand: "zoom", task: "Create the meeting links", app: "Zoom" },
      { brand: "notion", task: "Update the hiring tracker", app: "Notion" },
    ],
    action: "Send 3 interview invitations",
    detail: "Thu–Fri slots · Zoom links attached",
    check: "Preview: 14 applications scored · top 3 shortlisted",
    log: [
      ["ok", "Read 14 new applications"],
      ["warn", "Zoom rejected a meeting time in the past"],
      ["fix", "Repaired: re-picked the next free slot · rule saved"],
      ["ok", "3 invitations sent · Notion tracker updated"],
      ["next", "Watching the inbox · runs on every application"],
    ],
  },
];

function LogLine({ kind, text }: { kind: LogKind; text: string }) {
  if (kind === "fix") return <div className={`${s.logLine} ${s.logFix}`}><Wrench size={14} style={{ color: "var(--accent)" }} /> {text}</div>;
  const icon = kind === "ok" ? <Check size={14} className={s.logOk} /> : kind === "warn" ? <TriangleAlert size={14} className={s.logWarn} /> : <CalendarClock size={14} />;
  return <div className={s.logLine}>{icon} {text}</div>;
}

function Visual({ step, m }: { step: number; m: Mission }): ReactNode {
  if (step === 0) return (
    <div className={s.visCard}>
      <div className={s.visCaption}>You</div>
      <div className={s.visBig}>“{m.ask}”</div>
      <div className={s.visQuestion}><MessageCircleQuestion size={18} strokeWidth={1.75} style={{ flexShrink: 0, marginTop: 1, color: "var(--accent)" }} />
        <span><strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>One question first:</strong> {m.question}</span>
      </div>
    </div>
  );
  if (step === 1) return (
    <div className={s.visCard}>
      <div className={s.visCaption}>Mission plan · {m.plan.length} agents</div>
      <div className={s.planList}>
        {m.plan.map(a => (
          <div key={a.task} className={`${s.agentRow} ${s.agentRowIn}`}>
            <AppTile brand={a.brand} className={s.agentTile} />
            <span className={s.agentText}>{a.task}<span className={s.agentApp}>{a.app}</span></span>
            <span className={`${s.status} ${s.statusWait}`}><span className={s.statusLabel}>Planned</span></span>
          </div>
        ))}
      </div>
    </div>
  );
  if (step === 2) return (
    <div className={s.visCard}>
      <div className={s.visCaption}>Rehearsal complete · nothing changed yet</div>
      <div className={`${s.approval} ${s.approvalIn}`}>
        <div className={s.approvalTop}><ShieldCheck size={15} strokeWidth={1.9} /> Waiting for your approval</div>
        <div className={s.approvalLine}>{m.action}</div>
        <div className={s.approvalDetail}>{m.detail}</div>
        <div className={s.approvalBtns}><span className={s.approveBtn}>Approve</span><span className={s.reviewBtn}>Review</span></div>
      </div>
      <LogLine kind="ok" text={m.check} />
    </div>
  );
  return (
    <div className={s.visCard}>
      <div className={s.visCaption}>Run log</div>
      {m.log.map(([kind, text]) => <LogLine key={text} kind={kind} text={text} />)}
    </div>
  );
}

function MissionTabs({ mission, onPick, className }: { mission: number; onPick: (i: number) => void; className: string }) {
  return (
    <div className={className} role="group" aria-label="Example mission">
      <span className={s.howTabsLabel}>Example</span>
      {MISSIONS.map((m, i) => (
        <button key={m.label} type="button" aria-pressed={i === mission} className={`${s.scenarioTab} ${i === mission ? s.scenarioTabOn : ""}`} onClick={() => onPick(i)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

export default function HowItWorks() {
  const [active, setActive] = useState(0);
  const [mission, setMission] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const m = MISSIONS[mission];

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
    }, { rootMargin: "-45% 0px -45% 0px" });
    refs.current.forEach(el => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    // Phones get the mission picker above the steps (it sticks under the nav); larger screens get it above the sticky visual.
    <div className={s.howWrap}>
      <MissionTabs mission={mission} onPick={setMission} className={`${s.howTabs} ${s.howTabsInline}`} />
      <div className={s.howGrid}>
        <div className={s.steps}>
          {STEPS.map((st, i) => (
            <div key={st.title} ref={el => { refs.current[i] = el; }} data-step={i} className={`${s.step} ${active === i ? s.stepActive : ""}`}>
              <div className={s.stepNum}>0{i + 1}</div>
              <h3 className={s.stepTitle}>{st.title}</h3>
              <p className={s.stepText}>{st.text}</p>
              <div className={s.stepVisualInline} aria-hidden><div key={mission} className={`${s.vis} ${s.visSwap}`}><Visual step={i} m={m} /></div></div>
            </div>
          ))}
        </div>
        <div>
          <div className={s.howSticky}>
            <MissionTabs mission={mission} onPick={setMission} className={s.howTabs} />
            <div className={s.visStack} aria-hidden>
              {STEPS.map((_, i) => (
                <div key={i} className={`${s.vis} ${active === i ? s.visActive : ""}`}>
                  <div key={mission} className={s.visSwap} style={{ height: "100%" }}><Visual step={i} m={m} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
