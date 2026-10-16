import { ArrowRight, Check, Eye, FileCheck2, History, Lock, Mail, Minus, Plus, ShieldCheck, Share2 } from "lucide-react";
import HeroDemo from "@/components/landing/HeroDemo";
import HowItWorks from "@/components/landing/HowItWorks";
import Reveal from "@/components/landing/Reveal";
import { BRAND, BrandGlyph, type BrandKey } from "@/components/landing/brandIcons";
import s from "@/components/landing/landing.module.css";

// ============================================================
// Landing page — Hero, proof, how it works, safety, integrations,
// use cases, pricing, stories, FAQ, final call to action.
// ============================================================

const PROOF: BrandKey[] = ["gmail", "sheets", "zoho", "hubspot", "shopify", "razorpay", "notion", "whatsapp"];

const WALL: BrandKey[][] = [
  ["gmail", "sheets", "drive", "calendar", "docs", "slides", "forms", "meet", "analytics", "youtube", "zoho", "hubspot", "shopify", "razorpay", "stripe", "quickbooks", "xero", "paypal"],
  ["notion", "airtable", "trello", "asana", "clickup", "jira", "linear", "todoist", "basecamp", "confluence", "github", "gitlab", "vercel", "supabase", "sentry", "posthog", "mixpanel", "perplexity"],
  ["mailchimp", "brevo", "instagram", "facebook", "x", "reddit", "figma", "miro", "dropbox", "box", "typeform", "calendly", "zoom", "discord", "telegram", "whatsapp", "intercom", "zendesk", "wix", "webflow"],
];

const CASES: { tag: string; apps: BrandKey[]; ask: string; outcome: string }[] = [
  { tag: "Finance", apps: ["zoho", "drive", "gmail"], ask: "“Every month, export our P&L, balance sheet and cash flow from Zoho Books to Excel and email me the link.”", outcome: "Statements pulled straight from your books, formatted and filed — on the 5th, every month." },
  { tag: "Sales", apps: ["typeform", "hubspot", "gmail"], ask: "“When someone fills our website form, add them to HubSpot and send a personal welcome email.”", outcome: "Every lead captured and greeted within minutes, with nothing copied by hand." },
  { tag: "Operations", apps: ["shopify", "sheets", "whatsapp"], ask: "“Each evening, summarise today's Shopify orders and post the totals to our team.”", outcome: "One message the whole team reads, logged to a sheet for the month-end." },
  { tag: "Reporting", apps: ["analytics", "sheets", "slides"], ask: "“Every Monday at 9, send me last week's numbers with the three biggest changes.”", outcome: "A short, readable report — not a dashboard you have to remember to open." },
  { tag: "Marketing", apps: ["notion", "instagram", "facebook"], ask: "“Turn our latest blog post into this week's social posts and queue them for my approval.”", outcome: "Drafts ready to approve, in your voice, on the days you choose." },
  { tag: "Admin", apps: ["zoho", "sheets", "gmail"], ask: "“Find duplicate expenses this quarter and clean them up — show me the list first.”", outcome: "Duplicates found, every deletion listed for you to approve before anything changes." },
];

const PLANS = [
  { name: "Free Trial", price: "₹0", period: "", credits: "30 credits", features: ["1 active mission", "Claude for code generation (Gemini & GPT fallback)", "100 MB storage", "2 discovery questions", "No scheduling", "No multi-role agents"], cta: "Start free", href: "/login", highlight: false },
  { name: "Individual", price: "₹2,499", period: "/month", credits: "1,000 credits", features: ["5 active missions", "Claude's most capable model for code generation", "10 GB storage", "3-4 discovery questions", "Agent email inbox", "Up to 2 parallel roles"], cta: "Upgrade", href: "/pricing", highlight: true },
  { name: "Pro", price: "₹2,999", period: "/seat/mo", credits: "2,500 credits / seat", features: ["50 active missions", "Claude's most capable model for code generation", "100 GB storage", "5-6 discovery questions", "Unlimited multi-role agents", "Credit top-ups available"], cta: "Configure", href: "/pricing", highlight: false },
  { name: "Enterprise", price: "Custom", period: "", credits: "Unlimited credits", features: ["Unlimited missions", "Claude's most capable model + custom models", "1 TB storage", "8-10 discovery questions", "Dedicated support"], cta: "Contact sales", href: "/contact", highlight: false },
];

const STORIES = [
  { name: "Arjun S", role: "Founder, D2C Brand", text: "I used to spend 3 hours every Monday pulling sales reports and sending updates. Now one mission does it automatically — I just check my phone.", avatar: "AS" },
  { name: "Emin M", role: "Marketing Head", text: "We connected our CRM and the agents started writing follow-up emails for every new lead. It genuinely feels like we hired someone just for that.", avatar: "EM" },
  { name: "Nitto Raju", role: "Workshop Owner", text: "I told it to find local businesses in my area and send them an intro. It pulled the list, wrote the emails, and sent them — I didn't touch anything.", avatar: "NR" },
  { name: "Joel Joshi", role: "Agency Founder", text: "We run 8 client accounts. The content scheduling agent alone saves my team 2 full days every week. The ROI was obvious in the first run.", avatar: "JJ" },
];

const FAQS = [
  { q: "What is Agentic Factor?", a: "An AI operations team you hire by typing. Describe the work in plain language and Agentic Factor designs a team of specialised agents, connects your apps, and runs the work — on demand or on a schedule." },
  { q: "Will agents act without my permission?", a: "Not on anything that matters. Every mission first runs as a rehearsal that changes nothing, and actions that send, post, pay or delete wait for your one-click approval — with the exact details in front of you." },
  { q: "How do credits work?", a: "Every agent action — AI work, code execution, file processing — uses credits from your plan. The free trial includes 30 credits; paid plans refill monthly. You only pay for what your agents actually use." },
  { q: "Is my data secure?", a: "Credentials are encrypted with AES-256-GCM. Each workspace is isolated, every run executes in its own short-lived sandbox, and files open only for your team through links that expire in minutes." },
  { q: "Which apps can I connect?", a: "More than 1,600 — Google Workspace, Slack, HubSpot, Zoho, Shopify, Razorpay, Notion, Airtable and many more. Sign-in is handled securely, and API keys are encrypted at rest." },
  { q: "What happens when I run out of credits?", a: "Agents pause and let you know. Top up or wait for your monthly refill — nothing is lost." },
  { q: "Do you offer refunds?", a: "All sales are final and credits are non-refundable. Cancelling stops future billing but doesn't refund the current period." },
];

export default function LandingPage() {
  return (
    <div className={s.page}>
      {/* ═══ Hero ═══ */}
      <section className={s.hero}>
        <div className={`${s.container} ${s.heroGrid}`}>
          <div>
            <span className={`${s.eyebrow} ${s.fadeUp}`} style={{ ["--d" as string]: 60 }}>The AI operations team for lean businesses</span>
            <h1 className={s.heroTitle}>
              <span className={s.heroLine}><span style={{ ["--i" as string]: 0 }}>Describe the work.</span></span>
              <span className={s.heroLine}><span style={{ ["--i" as string]: 1 }}>Agents do{" "}
                <span className={s.heroAccent}>the rest.
                  <svg className={s.heroUnderline} viewBox="0 0 300 16" preserveAspectRatio="none" aria-hidden><path d="M3 11 C 70 4, 150 3, 297 8" /></svg>
                </span>
              </span></span>
            </h1>
            <p className={`${s.heroSub} ${s.fadeUp}`} style={{ ["--d" as string]: 520 }}>
              Agentic Factor turns a plain-language request into a team of AI agents that works across your apps, checks its own work, and asks before it changes anything that matters.
            </p>
            <div className={`${s.heroCtas} ${s.fadeUp}`} style={{ ["--d" as string]: 660 }}>
              <a href="/dashboard" className={`${s.btn} ${s.btnPrimary}`}>Try it free <ArrowRight size={17} strokeWidth={2} aria-hidden /></a>
              <a href="/signup" className={`${s.btn} ${s.btnGhost}`}>Create an account</a>
            </div>
            <p className={`${s.heroNote} ${s.fadeUp}`} style={{ ["--d" as string]: 780 }}><Check size={15} strokeWidth={2.4} aria-hidden /> 30 free credits · No credit card required</p>
          </div>
          <div className={s.heroVisual}><HeroDemo /></div>
        </div>
      </section>

      {/* ═══ Proof ═══ */}
      <section className={s.proof} aria-label="Works with">
        <div className={s.container}>
          <Reveal><p className={s.proofLabel}>Works with the apps your business already runs on</p></Reveal>
          <Reveal i={1}>
            <div className={s.proofLogos}>
              {PROOF.map(k => <span key={k} className={s.proofLogo}><BrandGlyph icon={BRAND[k]} size={20} color="currentColor" />{BRAND[k].title}</span>)}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ How it works ═══ */}
      <section id="how-it-works" className={s.section}>
        <div className={s.container}>
          <Reveal className={s.sectionHead}>
            <span className={s.eyebrow}>How it works</span>
            <h2 className={s.h2}>From a sentence to a <em>running operation.</em></h2>
            <p className={s.lead}>No flowcharts to draw, no code to maintain. You describe the outcome; the platform designs, tests and runs the work — and keeps it running.</p>
          </Reveal>
          <HowItWorks />
        </div>
      </section>

      {/* ═══ Safety ═══ */}
      <section id="safety" className={`${s.section} ${s.safety}`}>
        <div className={`${s.container} ${s.safetyGrid}`}>
          <div>
            <Reveal>
              <span className={s.eyebrow}>Safety</span>
              <h2 className={s.h2}>Nothing important happens <em>without you.</em></h2>
              <p className={s.lead}>Agents do the busywork. You keep the final say — with a full record of what happened and why.</p>
            </Reveal>
            <div className={s.safetyList}>
              {[
                { icon: Eye, title: "Rehearsal first", text: "Every mission runs once as a preview that touches nothing real." },
                { icon: ShieldCheck, title: "Approval on every change", text: "Emails, payments, posts and deletions wait for your one-click approval — exact details in front of you." },
                { icon: Lock, title: "Private by default", text: "Isolated workspaces, encrypted credentials, and files that open only for your team through expiring links." },
                { icon: History, title: "A record of everything", text: "Every run, approval and change is logged — who did what, and when." },
              ].map((f, i) => (
                <Reveal key={f.title} i={i}>
                  <div className={s.safetyIcon}><f.icon size={19} strokeWidth={1.75} /></div>
                  <div className={s.safetyTitle}>{f.title}</div>
                  <p className={s.safetyText}>{f.text}</p>
                </Reveal>
              ))}
            </div>
          </div>
          <Reveal i={2}>
            <div className={s.safetyCard} aria-label="Example approval request">
              <div className={s.safetyCardTop}><span>Approval needed</span><span>Monthly statements</span></div>
              <div className={s.safetyChange}><Mail size={16} /><div>Send 1 email to finance@yourcompany.com<small>“Statements for September” · 1 link attached</small></div></div>
              <div className={s.safetyChange}><Share2 size={16} /><div>Share “Financial Statements.xlsx” with 1 person<small>View only · finance@yourcompany.com</small></div></div>
              <div className={s.safetyChange}><FileCheck2 size={16} /><div>Rehearsal passed — totals reconcile<small>9 sheets · 0 warnings</small></div></div>
              <div className={s.safetyActions}>
                <span className={s.safetyApprove}><Check size={16} strokeWidth={2.2} /> Approve both</span>
                <span className={s.safetyReject}>Reject</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ Integrations ═══ */}
      <section id="integrations" className={s.section}>
        <div className={s.container}>
          <Reveal className={s.sectionHeadCenter}>
            <span className={s.eyebrow}>Integrations</span>
            <h2 className={s.h2}>1,600+ apps. <em>One sentence away.</em></h2>
            <p className={s.lead}>Connect once with secure sign-in, and every agent can use them — Google Workspace, HubSpot, Zoho, Shopify, Razorpay, Notion and the rest of your stack.</p>
          </Reveal>
        </div>
        <div className={s.wall} aria-label="Some of the apps you can connect">
          {WALL.map((row, r) => (
            <div key={r} className={s.wallRow}>
              <div className={`${s.wallTrack} ${r % 2 ? s.wallReverse : ""}`} style={{ ["--speed" as string]: `${64 + r * 14}s` }}>
                {[...row, ...row].map((k, i) => (
                  <span key={`${k}-${i}`} className={s.wallItem} aria-hidden={i >= row.length}>
                    <BrandGlyph icon={BRAND[k]} size={20} color="currentColor" />{BRAND[k].title}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className={s.container}>
          <div className={s.wallStat}>
            <Reveal className={s.stat}><div className={s.statNum}>1,600+</div><div className={s.statLabel}>apps to connect</div></Reveal>
            <Reveal className={s.stat} i={1}><div className={s.statNum}>60,000+</div><div className={s.statLabel}>actions agents can take</div></Reveal>
            <Reveal className={s.stat} i={2}><div className={s.statNum}>1</div><div className={s.statLabel}>sentence to start</div></Reveal>
          </div>
        </div>
      </section>

      {/* ═══ Use cases ═══ */}
      <section id="use-cases" className={s.section} style={{ paddingTop: 0 }}>
        <div className={s.container}>
          <Reveal className={s.sectionHead}>
            <span className={s.eyebrow}>What teams hand over</span>
            <h2 className={s.h2}>Work your team <em>stops doing by hand.</em></h2>
          </Reveal>
          <div className={s.caseGrid}>
            {CASES.map((c, i) => (
              <Reveal key={c.tag} i={i % 3} style={{ height: "100%" }}>
                <article className={s.case}>
                  <div className={s.caseTop}>
                    <span className={s.caseTag}>{c.tag}</span>
                    <span className={s.caseApps}>{c.apps.map(a => <span key={a} className={s.caseApp}><BrandGlyph icon={BRAND[a]} size={15} /></span>)}</span>
                  </div>
                  <p className={s.caseQuote}>{c.ask}</p>
                  <p className={s.caseOutcome}><Check size={16} strokeWidth={2.2} /> {c.outcome}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Pricing ═══ */}
      <section id="pricing" className={s.section} style={{ paddingTop: 0 }}>
        <div className={s.container}>
          <Reveal className={s.sectionHeadCenter}>
            <span className={s.eyebrow}>Pricing</span>
            <h2 className={s.h2}>Simple, <em>usage-based</em> pricing.</h2>
            <p className={s.lead}>Start free. Pay for what your agents actually use — Claude writes and repairs your agents&apos; code, with Gemini &amp; GPT as fallback.</p>
          </Reveal>
          <div className={s.planGrid}>
            {PLANS.map((p, i) => (
              <Reveal key={p.name} i={i} style={{ display: "flex" }}>
                <div className={`${s.plan} ${p.highlight ? s.planFeatured : ""}`} style={{ width: "100%" }}>
                  {p.highlight && <span className={s.planBadge}>Most popular</span>}
                  <div className={s.planName}>{p.name}</div>
                  <div className={s.planPrice}>{p.price}<span className={s.planPeriod}>{p.period}</span></div>
                  <div className={s.planCredits}>{p.credits}</div>
                  <ul className={s.featureList}>
                    {p.features.map(f => f.startsWith("No ")
                      ? <li key={f} className={s.planNo}><Minus size={15} strokeWidth={2} aria-hidden /> {f}</li>
                      : <li key={f}><Check size={15} strokeWidth={2.2} aria-hidden /> {f}</li>)}
                  </ul>
                  <a href={p.href} className={`${s.btn} ${p.highlight ? s.btnPrimary : s.btnGhost} ${s.planCta}`}>{p.cta}</a>
                </div>
              </Reveal>
            ))}
          </div>
          <p className={s.pricingNote}>Prices in INR. Annual plans include two months free.</p>
        </div>
      </section>

      {/* ═══ Stories ═══ */}
      <section id="stories" className={s.section} style={{ paddingTop: 0 }}>
        <div className={s.container}>
          <Reveal className={s.sectionHead}>
            <span className={s.eyebrow}>From the people using it</span>
            <h2 className={s.h2}>Less busywork. <em>More business.</em></h2>
          </Reveal>
          <div className={s.storyGrid}>
            {STORIES.map((t, i) => (
              <Reveal key={t.name} i={i % 2}>
                <figure className={s.story}>
                  <div>
                    <div className={s.storyMark} aria-hidden>“</div>
                    <blockquote className={s.storyQuote}>{t.text}</blockquote>
                  </div>
                  <figcaption className={s.storyPerson}>
                    <span className={s.storyAvatar} aria-hidden>{t.avatar}</span>
                    <span><div className={s.storyName}>{t.name}</div><div className={s.storyRole}>{t.role}</div></span>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className={s.section} style={{ paddingTop: 0 }}>
        <div className={`${s.container} ${s.faqGrid}`}>
          <Reveal>
            <span className={s.eyebrow}>FAQ</span>
            <h2 className={s.h2}>Questions, <em>answered.</em></h2>
            <p className={s.lead}>Anything else? Write to <a href="mailto:hello@agenticfactor.io" style={{ color: "var(--accent)" }}>hello@agenticfactor.io</a>.</p>
          </Reveal>
          <Reveal i={1}>
            <div className={s.faqList}>
              {FAQS.map(f => (
                <details key={f.q} className={s.faqItem}>
                  <summary>{f.q}<span className={s.faqIcon} aria-hidden><Plus size={15} strokeWidth={1.75} /></span></summary>
                  <p className={s.faqA}>{f.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ Final call to action ═══ */}
      <section className={s.final}>
        <div className={s.container}>
          <Reveal>
            <h2 className={s.finalTitle}>Hire your first agent <em>in a sentence.</em></h2>
            <p className={s.finalSub}>Start with 30 free credits. No credit card required.</p>
            <div className={s.finalCtas}>
              <a href="/dashboard" className={`${s.btn} ${s.btnPrimary}`}>Try it free <ArrowRight size={17} strokeWidth={2} aria-hidden /></a>
              <a href="/signup" className={`${s.btn} ${s.btnGhost}`}>Create an account</a>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
