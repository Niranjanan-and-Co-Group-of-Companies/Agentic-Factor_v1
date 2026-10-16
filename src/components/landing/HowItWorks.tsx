"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, MessageCircleQuestion, ShieldCheck, TriangleAlert, Wrench, CalendarClock } from "lucide-react";
import { BRAND, BrandGlyph, type BrandKey } from "./brandIcons";
import s from "./landing.module.css";

const STEPS = [
  { title: "Describe it", text: "Type what you need the way you'd brief a colleague. If something important is unclear, it asks — instead of guessing." },
  { title: "It builds the team", text: "An AI architect designs the agents, picks the right apps and actions from more than 1,600, and writes the code each one runs." },
  { title: "It rehearses. You approve.", text: "Every mission first runs as a rehearsal that changes nothing. You see exactly what it will send, create or delete — and approve in one click." },
  { title: "It runs, and fixes itself", text: "On demand or on a schedule. When an app rejects a step, the platform repairs it and remembers the rule for next time." },
];

const PLAN: { brand: BrandKey; task: string; app: string }[] = [
  { brand: "zoho", task: "Read statements from Zoho Books", app: "Zoho Books" },
  { brand: "sheets", task: "Build a formatted workbook", app: "Excel workbook" },
  { brand: "drive", task: "Save it to your Drive", app: "Google Drive" },
  { brand: "gmail", task: "Email you the link", app: "Gmail" },
];

function Visual({ step }: { step: number }): ReactNode {
  if (step === 0) return (
    <div className={s.visCard}>
      <div className={s.visCaption}>You</div>
      <div className={s.visBig}>“Every month, export our statements from Zoho Books to Excel and email me the link.”</div>
      <div className={s.visQuestion}><MessageCircleQuestion size={18} strokeWidth={1.75} style={{ flexShrink: 0, marginTop: 1, color: "var(--accent)" }} />
        <span><strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>One question first:</strong> should drafts and voided records be included?</span>
      </div>
    </div>
  );
  if (step === 1) return (
    <div className={s.visCard}>
      <div className={s.visCaption}>Mission plan · 4 agents</div>
      <div className={s.planList}>
        {PLAN.map(a => (
          <div key={a.task} className={`${s.agentRow} ${s.agentRowIn}`}>
            <span className={s.agentTile}><BrandGlyph icon={BRAND[a.brand]} size={18} /></span>
            <span className={s.agentText}>{a.task}<span className={s.agentApp}>{a.app}</span></span>
            <span className={`${s.status} ${s.statusWait}`}>Planned</span>
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
        <div className={s.approvalLine}>Send 1 email</div>
        <div className={s.approvalDetail}>to you@yourcompany.com · link to “Financial Statements.xlsx”</div>
        <div className={s.approvalBtns}><span className={s.approveBtn}>Approve</span><span className={s.reviewBtn}>Review</span></div>
      </div>
      <div className={s.logLine}><Check size={14} className={s.logOk} /> Workbook preview: 9 sheets, totals checked</div>
    </div>
  );
  return (
    <div className={s.visCard}>
      <div className={s.visCaption}>Run log</div>
      <div className={s.logLine}><Check size={14} className={s.logOk} /> Read the period’s reports and transactions</div>
      <div className={s.logLine}><TriangleAlert size={14} className={s.logWarn} /> The app rejected one request’s date format</div>
      <div className={`${s.logLine} ${s.logFix}`}><Wrench size={14} style={{ color: "var(--accent)" }} /> Repaired the step · rule saved for next time</div>
      <div className={s.logLine}><Check size={14} className={s.logOk} /> Workbook saved · email sent</div>
      <div className={s.logLine}><CalendarClock size={14} /> Next run: 1st of the month, 9:00 am</div>
    </div>
  );
}

export default function HowItWorks() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
    }, { rootMargin: "-45% 0px -45% 0px" });
    refs.current.forEach(el => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className={s.howGrid}>
      <div className={s.steps}>
        {STEPS.map((st, i) => (
          <div key={st.title} ref={el => { refs.current[i] = el; }} data-step={i} className={`${s.step} ${active === i ? s.stepActive : ""}`}>
            <div className={s.stepNum}>0{i + 1}</div>
            <h3 className={s.stepTitle}>{st.title}</h3>
            <p className={s.stepText}>{st.text}</p>
            <div className={s.stepVisualInline} aria-hidden><div className={s.vis}><Visual step={i} /></div></div>
          </div>
        ))}
      </div>
      <div aria-hidden>
        <div className={s.howSticky}>
          {STEPS.map((_, i) => <div key={i} className={`${s.vis} ${active === i ? s.visActive : ""}`}><Visual step={i} /></div>)}
        </div>
      </div>
    </div>
  );
}
