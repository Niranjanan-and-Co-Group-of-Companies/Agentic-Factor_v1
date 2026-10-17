'use client';
// The live run card (chat and Command Center), the progress strip under the mission header, and the
// running dot for the missions list. All three read the same shared view, so they always agree.

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, CircleCheck, CircleX, ShieldCheck, X } from 'lucide-react';
import { LogoMark } from '@/components/brand/Logo';
import { kickLive, useMissionLive, useNow, useRunView, type AgentStep, type LiveAgent, type LiveRunView } from './useLiveRun';
import s from './runs.module.css';

const ACTIVE_STEPS: AgentStep[] = ['working', 'repairing', 'checking', 'acting'];
const isFinished = (status?: string) => status === 'completed' || status === 'failed';

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${String(sec % 60).padStart(2, '0')}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** "googlesheets" → "Google Sheets", "zoho_books" → "Zoho Books". */
export function appName(slug: string): string {
  const lower = slug.toLowerCase();
  const google = /^google([a-z]+)$/.exec(lower);
  const words = (google ? `google ${google[1]}` : lower.replace(/[_-]+/g, ' ')).split(' ').filter(Boolean);
  return words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** The server's clock now, from the moment its answer arrived. */
function serverNow(view: LiveRunView, receivedAt: number, now: number): number {
  return Date.parse(view.serverTime) + Math.max(0, now - receivedAt);
}

/** One line for where the run is: shared by the card and the strip. */
export function runHeadline(view: LiveRunView, nowMs: number): string {
  const run = view.run;
  if (!run) return '';
  const rehearsal = run.mode === 'rehearsal';
  const total = view.agents.length || run.agentsTotal;
  const current = view.agents.findIndex(a => a.step !== 'done' && a.step !== 'skipped');
  const step = current === -1 ? total : current + 1;
  switch (run.status) {
    case 'queued':
      return nowMs - Date.parse(run.startedAt) > 45_000 ? 'Waiting for a free worker…' : 'Starting…';
    case 'running':
      return total > 1 ? `Working — step ${step} of ${total}` : 'Working…';
    case 'paused':
      if (view.approval) return view.approval.kind === 'rehearsal' ? 'Check the preview to finish the rehearsal' : 'Waiting for your approval';
      return 'Paused';
    case 'completed':
      return rehearsal ? 'Rehearsal passed' : `Done in ${fmtDuration(run.durationMs ?? (run.completedAt ? Date.parse(run.completedAt) - Date.parse(run.startedAt) : null)) || 'moments'}`;
    case 'failed': {
      const failed = view.agents.find(a => a.step === 'failed');
      return failed ? `Stopped at step ${view.agents.indexOf(failed) + 1} — ${failed.role}` : 'The run stopped';
    }
  }
}

function elapsedLabel(view: LiveRunView, nowMs: number): string {
  const run = view.run!;
  if (isFinished(run.status)) {
    return fmtDuration(run.durationMs ?? (run.completedAt ? Date.parse(run.completedAt) - Date.parse(run.startedAt) : null));
  }
  if (run.status === 'paused') {
    // Waiting on the customer: how long it has waited, not how long the run has been open.
    const since = Math.max(0, ...view.agents.map(a => (a.lastSignalAt ? Date.parse(a.lastSignalAt) : 0)));
    return since ? `waiting ${fmtDuration(nowMs - since)}` : '';
  }
  const elapsed = fmtDuration(nowMs - Date.parse(run.startedAt));
  return view.typicalMs ? `${elapsed} · usually ~${fmtDuration(view.typicalMs)}` : elapsed;
}

const segClass = (step: AgentStep) =>
  step === 'done' ? s.segDone
  : step === 'failed' ? s.segFailed
  : step === 'approval' || step === 'paused' ? s.segHold
  : ACTIVE_STEPS.includes(step) ? s.segActive
  : '';

function Segments({ agents, className }: { agents: LiveAgent[]; className: string }) {
  return (
    <div className={className} aria-hidden>
      {agents.map(a => <span key={a.id} className={`${s.seg} ${segClass(a.step)}`} />)}
    </div>
  );
}

// Brand tiles are white in both themes, so the platform's mark keeps its light-theme colours there.
const MARK_ON_WHITE = { '--logo-ink': '#201D18' } as CSSProperties;

function AppTile({ slug }: { slug: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={s.tile} title={appName(slug)}>
      {broken
        ? <span className={s.tileLetter}>{slug[0]?.toUpperCase()}</span>
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={`https://logos.composio.dev/api/${slug}`} alt={appName(slug)} onError={() => setBroken(true)} />}
    </span>
  );
}

function AppTiles({ apps }: { apps: string[] }) {
  return (
    <span className={s.tiles}>
      {apps.length === 0
        ? <span className={s.tile} style={MARK_ON_WHITE} title="Agentic Factor"><LogoMark size={22} /></span>
        : apps.slice(0, 2).map(a => <AppTile key={a} slug={a} />)}
    </span>
  );
}

function stepView(a: LiveAgent, rehearsal: boolean, nowMs: number) {
  const apps = a.apps.map(appName).join(', ');
  const quiet = a.lastSignalAt ? nowMs - Date.parse(a.lastSignalAt) : 0;
  switch (a.step) {
    case 'working':
      return { chip: 'Working', chipCls: s.chipWorking, nodeCls: s.nodeWorking, note: quiet > 45_000 ? 'Still working — this step takes a while' : apps ? `Working in ${apps}` : 'Working' };
    case 'repairing':
      return { chip: 'Fixing', chipCls: s.chipRepair, nodeCls: s.nodeRepair, note: `Hit a problem — fixing it${a.attempt ? ` (try ${a.attempt}${a.maxAttempts ? ` of ${a.maxAttempts}` : ''})` : ''}${a.note ? `: ${a.note}` : ''}`, noteCls: s.noteRepair };
    case 'checking':
      return { chip: 'Checking', chipCls: s.chipWorking, nodeCls: s.nodeWorking, note: 'Checking the result before passing it on' };
    case 'acting':
      return { chip: 'Doing it', chipCls: s.chipWorking, nodeCls: s.nodeWorking, note: 'Making the real changes now' };
    case 'approval':
      return rehearsal
        ? { chip: 'Your check', chipCls: s.chipHold, nodeCls: s.nodeHold, note: 'Prepared a preview of what it would do' }
        : { chip: 'Needs you', chipCls: s.chipHold, nodeCls: s.nodeHold, note: 'Waiting for your OK before it acts' };
    case 'paused':
      return { chip: 'Paused', chipCls: s.chipHold, nodeCls: s.nodeHold };
    case 'done': {
      const took = a.startedAt && a.finishedAt ? fmtDuration(Date.parse(a.finishedAt) - Date.parse(a.startedAt)) : '';
      return { chip: took || 'Done', chipCls: s.chipDone, nodeCls: s.nodeDone, done: true };
    }
    case 'failed':
      return { chip: 'Failed', chipCls: s.chipFailed, nodeCls: s.nodeFailed, note: a.note, noteCls: s.noteFailed, failed: true };
    case 'skipped':
      return { chip: 'Skipped', chipCls: s.chipSkipped, nodeCls: s.nodeSkipped };
    default:
      return { chip: 'Waiting', chipCls: s.chipWaiting, nodeCls: '' };
  }
}

interface CardProps {
  missionId: string;
  /** The run this card follows; the mission's latest run when omitted. */
  runId?: string;
  /** Command Center: mission name on top, no previews, links into the mission. */
  compact?: boolean;
  /** Sends a message to the chat (Explain, Schedule…). */
  onAsk?: (text: string) => void;
  /** Starts a new run. */
  onRun?: () => void;
}

export default function LiveRunCard({ missionId, runId, compact = false, onAsk, onRun }: CardProps) {
  const { view, receivedAt } = useRunView(missionId, runId);
  const running = !!view?.run && !isFinished(view.run.status);
  const now = useNow(running);
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  if (!view?.run) {
    return (
      <div className={s.card} aria-busy="true">
        <div className={s.head}><span className={s.runNo}>Starting the run…</span></div>
        <div className={s.bar}><span className={s.skeleton} style={{ flex: 1, height: 4 }} /></div>
        <div style={{ padding: '6px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className={s.skeleton} style={{ width: '70%' }} />
          <span className={s.skeleton} style={{ width: '55%' }} />
        </div>
      </div>
    );
  }

  const run = view.run;
  const rehearsal = run.mode === 'rehearsal';
  const nowMs = serverNow(view, receivedAt, now);
  const headline = runHeadline(view, nowMs);
  const agents = view.agents;
  const approval = view.approval;

  const decide = async () => {
    if (!approval) return;
    setDeciding(true);
    setDecisionError(null);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: approval.id, decision: 'approved', missionId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setDecisionError(err.error ?? 'Could not record that. Try again, or use the Approvals page.');
      }
    } catch {
      setDecisionError('Could not reach the server. Try again.');
    } finally {
      setDeciding(false);
      kickLive(missionId);
    }
  };

  const HeadIcon = run.status === 'completed' ? CircleCheck : run.status === 'failed' ? CircleX : approval ? ShieldCheck : null;
  const headIconColor = run.status === 'completed' ? 'var(--emerald)' : run.status === 'failed' ? 'var(--rose)' : 'var(--amber)';

  const sub = run.status === 'completed'
    ? (rehearsal ? 'Nothing was sent or changed. From the next run, this mission works for real.' : undefined)
    : run.status === 'failed'
      ? run.error
      : rehearsal
        ? 'Rehearsal — nothing will be sent or changed. You’ll check what it would do.'
        : 'Live run — the changes are real.';

  return (
    <div className={`${s.card} ${rehearsal ? s.cardRehearsal : ''}`} role="status" aria-live="polite" aria-label={`Run ${run.number}: ${headline}`}>
      <div className={s.head}>
        {compact && <span className={s.missionName}>{view.mission.title}</span>}
        <span className={`${s.stamp} ${rehearsal ? s.stampRehearsal : s.stampLive}`}>{rehearsal ? 'Rehearsal' : 'Live'}</span>
        <span className={s.runNo}>Run #{run.number}</span>
        <span className={s.timer}>{elapsedLabel(view, nowMs)}</span>
      </div>

      <div className={s.headline}>
        {HeadIcon && <HeadIcon size={17} strokeWidth={2} style={{ color: headIconColor }} aria-hidden />}
        {headline}
      </div>
      {sub && !compact && <div className={s.sub}>{sub}</div>}

      <Segments agents={agents} className={s.bar} />

      <ol className={s.list}>
        {agents.map((a, i) => {
          const v = stepView(a, rehearsal, nowMs);
          const next = agents[i + 1];
          const flowing = a.step === 'done' && !!next && ACTIVE_STEPS.includes(next.step);
          const rowCls = [
            s.agent,
            a.step === 'done' ? s.agentDone : '',
            flowing ? s.agentFlow : '',
            a.step === 'waiting' ? s.agentWaiting : '',
            a.step === 'skipped' ? s.agentSkipped : '',
          ].join(' ');
          return (
            <li key={a.id} className={rowCls}>
              <span className={`${s.node} ${v.nodeCls}`} aria-hidden>
                {v.done && <Check size={11} strokeWidth={3} />}
                {v.failed && <X size={11} strokeWidth={3} />}
              </span>
              <AppTiles apps={a.apps} />
              <span style={{ minWidth: 0 }}>
                <span className={s.role} style={{ display: 'block' }}>{a.role}</span>
                {v.note && !(compact && a.step === 'working') && <span className={`${s.note} ${v.noteCls ?? ''}`}>{v.note}</span>}
              </span>
              <span className={`${s.chip} ${v.chipCls}`}>
                {v.done && <Check size={11} strokeWidth={2.6} aria-hidden />}
                {v.chip}
              </span>
            </li>
          );
        })}
      </ol>

      {approval && run.status !== 'completed' && run.status !== 'failed' && (
        <div className={s.approval}>
          <div className={s.approvalTitle}>
            <ShieldCheck size={15} strokeWidth={2} aria-hidden />
            {approval.kind === 'rehearsal' ? 'Here’s what it would do' : 'It wants to make these changes'}
          </div>
          <div className={s.approvalText}>
            {approval.kind === 'rehearsal'
              ? 'Nothing has been sent or changed. If this looks right, continue and the rehearsal finishes.'
              : 'These are real. Review them, then approve to let it go ahead.'}
          </div>
          {approval.actions.length > 0 && (
            <div className={s.actions}>{approval.actions.map(act => <span key={act} className={s.action}>{act}</span>)}</div>
          )}
          {!compact && approval.preview && <div className={s.preview}>{approval.preview}</div>}
          <div className={s.buttons}>
            {approval.kind === 'rehearsal' && !compact ? (
              <>
                <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={decide} disabled={deciding}>
                  {deciding ? 'Continuing…' : <>Looks right — continue <ArrowRight size={14} aria-hidden /></>}
                </button>
                <Link href="/approvals" className={`${s.btn} ${s.btnGhost}`}>See full details</Link>
              </>
            ) : (
              <Link href="/approvals" className={`${s.btn} ${s.btnPrimary}`}>Review {approval.kind === 'rehearsal' ? 'the preview' : 'and approve'} <ArrowRight size={14} aria-hidden /></Link>
            )}
          </div>
          {decisionError && <div className={s.approvalText} style={{ color: 'var(--rose)' }}>{decisionError}</div>}
        </div>
      )}

      {(isFinished(run.status) || compact) && (
        <div className={`${s.foot} ${run.status === 'completed' && rehearsal ? s.footRehearsal : ''}`}>
          {!compact && run.status === 'completed' && !rehearsal && run.summary && <div className={s.summary}>{run.summary}</div>}
          <div className={s.buttons}>
            {compact ? (
              <Link href={`/dashboard/missions/${missionId}/chat`} className={`${s.btn} ${s.btnGhost}`}>Open mission <ArrowRight size={14} aria-hidden /></Link>
            ) : run.status === 'completed' && rehearsal ? (
              <>
                {onRun && <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onRun}>Run it for real now</button>}
                {onAsk && <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => onAsk('Schedule this')}>Put it on a schedule</button>}
              </>
            ) : run.status === 'completed' ? (
              onAsk && <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => onAsk('What did the mission accomplish in that run?')}>What did it do?</button>
            ) : (
              <>
                {onAsk && <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => onAsk('Explain what failed and how to fix it')}>Explain and fix</button>}
                {onRun && <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onRun}>Try again</button>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Slim progress line under the mission header: the latest run, while it runs and for a while after. */
export function RunStrip({ missionId, onView }: { missionId: string; onView?: () => void }) {
  const live = useMissionLive(missionId);
  const view = live?.latest ?? null;
  const running = !!view?.run && !isFinished(view.run.status);
  const now = useNow(running);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!view?.run || !live) return null;

  const run = view.run;
  const nowMs = serverNow(view, live.receivedAt, now);
  const finished = isFinished(run.status);
  const endedAt = Date.parse(run.completedAt ?? run.startedAt);
  if (finished && (dismissed === run.id || nowMs - endedAt > 10 * 60_000)) return null;

  const dotCls = run.status === 'completed' ? s.stripDotDone
    : run.status === 'failed' ? s.stripDotFailed
    : run.status === 'paused' ? s.stripDotHold
    : s.stripDotRun;

  return (
    <div className={s.strip} role="status" aria-live="polite">
      <span className={`${s.stripDot} ${dotCls}`} aria-hidden />
      <div className={s.stripMain}>
        <div className={s.stripLine}>
          <span className={`${s.stamp} ${run.mode === 'rehearsal' ? s.stampRehearsal : s.stampLive}`}>{run.mode === 'rehearsal' ? 'Rehearsal' : 'Live'}</span>
          <span className={s.runNo}>#{run.number}</span>
          <span className={s.stripText}>{runHeadline(view, nowMs)}</span>
          <span className={s.timer}>{elapsedLabel(view, nowMs)}</span>
        </div>
        <Segments agents={view.agents} className={s.stripBar} />
      </div>
      {onView && <button type="button" className={s.linkBtn} onClick={onView}>View</button>}
      {finished && <button type="button" className={s.closeBtn} onClick={() => setDismissed(run.id)} aria-label="Dismiss">×</button>}
    </div>
  );
}

/** Pulsing dot for a mission that is running, amber when it waits on you. */
export function RunDot({ state }: { state?: 'running' | 'approval' }) {
  if (!state) return null;
  return (
    <span
      className={`${s.runDot} ${state === 'approval' ? s.runDotHold : s.runDotRun}`}
      title={state === 'approval' ? 'Waiting for your approval' : 'Running now'}
      aria-label={state === 'approval' ? 'Waiting for your approval' : 'Running now'}
    />
  );
}
