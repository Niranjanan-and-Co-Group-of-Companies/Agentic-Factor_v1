"use client";
import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, MessageSquareText, ShieldCheck, Clock } from "lucide-react";
import { BRAND, BrandGlyph, type BrandKey } from "./brandIcons";
import s from "./landing.module.css";

type Agent = { brand: BrandKey; task: string; app: string };
type Scenario = { ask: string; agents: Agent[]; action: string; detail: string; result: string; bars: number[] };

const SCENARIOS: Scenario[] = [
  {
    ask: "Every Monday, email me last week's sales by region from Zoho Books.",
    agents: [
      { brand: "zoho", task: "Read last week's invoices", app: "Zoho Books" },
      { brand: "sheets", task: "Summarise sales by region", app: "Google Sheets" },
      { brand: "gmail", task: "Email you the report", app: "Gmail" },
    ],
    action: "Send 1 email",
    detail: "to you@yourcompany.com · “Weekly sales by region”",
    result: "Done in 41s · repeats Mondays, 9:00 am",
    bars: [7, 11, 9, 15, 12, 19, 16],
  },
  {
    ask: "When someone fills our website form, add them to HubSpot and send a welcome email.",
    agents: [
      { brand: "typeform", task: "Watch for new form entries", app: "Typeform" },
      { brand: "hubspot", task: "Create or update the contact", app: "HubSpot" },
      { brand: "gmail", task: "Send a personal welcome", app: "Gmail" },
    ],
    action: "Send 1 email",
    detail: "to the new lead · “Welcome — here’s what happens next”",
    result: "Live · runs on every new entry",
    bars: [5, 8, 12, 10, 14, 17, 21],
  },
  {
    ask: "Each evening, post today's Shopify orders and revenue to our team on WhatsApp.",
    agents: [
      { brand: "shopify", task: "Read today's orders", app: "Shopify" },
      { brand: "sheets", task: "Log totals to the daily sheet", app: "Google Sheets" },
      { brand: "whatsapp", task: "Post the evening summary", app: "WhatsApp" },
    ],
    action: "Post 1 message",
    detail: "to Ops team · “Today: 38 orders, ₹1,24,500”",
    result: "Done in 33s · repeats daily, 8:00 pm",
    bars: [9, 7, 12, 16, 13, 18, 22],
  },
];

type RowStatus = "hidden" | "wait" | "run" | "done";
interface Frame { typed: number; rows: RowStatus[]; approval: boolean; pressed: boolean; approved: boolean; result: boolean; leaving: boolean }

const finished = (sc: Scenario): Frame => ({ typed: sc.ask.length, rows: ["done", "done", "done"], approval: true, pressed: false, approved: true, result: true, leaving: false });
const empty = (): Frame => ({ typed: 0, rows: ["hidden", "hidden", "hidden"], approval: false, pressed: false, approved: false, result: false, leaving: false });

export default function HeroDemo() {
  const [index, setIndex] = useState(0);
  const [frame, setFrame] = useState<Frame>(() => finished(SCENARIOS[0]));
  const [active, setActive] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Animate only while visible and when the visitor hasn't asked for reduced motion.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !rootRef.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { threshold: 0.25 });
    io.observe(rootRef.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return;
    const sc = SCENARIOS[index];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const set = (patch: Partial<Frame> | ((f: Frame) => Partial<Frame>)) =>
      setFrame(f => ({ ...f, ...(typeof patch === "function" ? patch(f) : patch) }));
    const row = (i: number, st: RowStatus) => set(f => { const rows = [...f.rows]; rows[i] = st; return { rows }; });

    setFrame(empty());
    let t = 350;
    // Type the request, a little unevenly, like a person.
    for (let c = 1; c <= sc.ask.length; c++) {
      t += 26 + (sc.ask[c - 1] === " " ? 30 : 0) + ((c * 7) % 11);
      const n = c;
      at(t, () => set({ typed: n }));
    }
    t += 520;
    [0, 1, 2].forEach(i => { at(t + i * 360, () => row(i, "wait")); at(t + i * 360 + 260, () => row(i, "run")); });
    t += 3 * 360 + 900;
    [0, 1, 2].forEach(i => at(t + i * 380, () => row(i, "done")));
    t += 3 * 380 + 420;
    at(t, () => set({ approval: true }));
    t += 1550;
    at(t, () => set({ pressed: true }));
    t += 200;
    at(t, () => set({ pressed: false, approved: true }));
    t += 480;
    at(t, () => set({ result: true }));
    t += 2900;
    at(t, () => set({ leaving: true }));
    t += 460;
    at(t, () => setIndex(i => (i + 1) % SCENARIOS.length));
    return () => timers.forEach(clearTimeout);
  }, [index, active]);

  const sc = SCENARIOS[index];
  const typing = frame.typed < sc.ask.length;

  return (
    <div ref={rootRef} className={s.demo} aria-label="Example: a mission being built and approved" role="img">
      <div className={s.demoHead}>
        <span className={s.demoLabel}><MessageSquareText size={14} strokeWidth={1.75} aria-hidden /> Command Center</span>
        <span className={s.demoLive}><span className={s.demoDot} aria-hidden /> Live</span>
      </div>
      <div className={`${s.demoBody} ${frame.leaving ? s.demoBodyOut : ""}`} aria-hidden>
        <div>
          <div className={s.demoKicker}>You asked</div>
          <div className={s.demoInput}>
            <span>{sc.ask.slice(0, frame.typed)}{typing && <span className={s.caret} />}</span>
          </div>
        </div>

        <div>
          <div className={s.demoKicker}>Mission plan</div>
          <div className={s.planList}>
            {sc.agents.map((a, i) => {
              const st = frame.rows[i];
              return (
                <div key={`${index}-${i}`} className={`${s.agentRow} ${st !== "hidden" ? s.agentRowIn : ""}`}>
                  <span className={s.agentTile}><BrandGlyph icon={BRAND[a.brand]} size={18} /></span>
                  <span className={s.agentText}>{a.task}<span className={s.agentApp}>{a.app}</span></span>
                  {st === "run" ? (
                    <span className={`${s.status} ${s.statusRun}`}><LoaderCircle size={11} strokeWidth={2.2} className={s.spin} /> Rehearsing</span>
                  ) : st === "done" ? (
                    <span className={`${s.status} ${s.statusDone}`}><Check size={11} strokeWidth={2.4} /> Ready</span>
                  ) : (
                    <span className={`${s.status} ${s.statusWait}`}>Queued</span>
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
      <div className={s.scenarioDots} aria-hidden>
        {SCENARIOS.map((_, i) => <span key={i} className={`${s.scenarioDot} ${i === index ? s.scenarioDotOn : ""}`} />)}
      </div>
    </div>
  );
}
