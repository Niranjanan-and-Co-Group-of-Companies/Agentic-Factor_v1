// How a run and its agents are described — the website's wording (src/components/runs/LiveRunCard.tsx).

import type { LiveAgent, LiveRunView } from '@contracts';

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${String(sec % 60).padStart(2, '0')}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export const isFinished = (status?: string) => status === 'completed' || status === 'failed';

export function headline(view: LiveRunView, now: number): string {
  const run = view.run!;
  const total = view.agents.length;
  const current = view.agents.findIndex(a => !['done', 'skipped'].includes(a.step));
  const step = current === -1 ? total : current + 1;
  const rehearsal = run.mode === 'rehearsal';
  switch (run.status) {
    case 'queued': return now - Date.parse(run.startedAt) > 45_000 ? 'Waiting for a free worker…' : 'Starting…';
    case 'running': return total > 1 ? `Working — step ${step} of ${total}` : 'Working…';
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

export type StepTone = 'muted' | 'info' | 'amber' | 'emerald' | 'rose';

export function stepView(a: LiveAgent, rehearsal: boolean, now: number): { chip: string; tone: StepTone; note?: string } {
  const quiet = a.lastSignalAt ? now - Date.parse(a.lastSignalAt) : 0;
  switch (a.step) {
    case 'working': return { chip: 'Working', tone: 'info', note: quiet > 45_000 ? 'Still working — this step takes a while' : 'Working' };
    case 'repairing': return { chip: 'Fixing', tone: 'amber', note: `Hit a problem — fixing it${a.attempt ? ` (try ${a.attempt}${a.maxAttempts ? ` of ${a.maxAttempts}` : ''})` : ''}${a.note ? `: ${a.note}` : ''}` };
    case 'checking': return { chip: 'Checking', tone: 'info', note: 'Checking the result before passing it on' };
    case 'acting': return { chip: 'Doing it', tone: 'info', note: 'Making the real changes now' };
    case 'approval': return rehearsal
      ? { chip: 'Your check', tone: 'amber', note: 'Prepared a preview of what it would do' }
      : { chip: 'Needs you', tone: 'amber', note: 'Waiting for your OK before it acts' };
    case 'paused': return { chip: 'Paused', tone: 'amber' };
    case 'done': {
      const took = a.startedAt && a.finishedAt ? fmtDuration(Date.parse(a.finishedAt) - Date.parse(a.startedAt)) : '';
      return { chip: took || 'Done', tone: 'emerald' };
    }
    case 'failed': return { chip: 'Failed', tone: 'rose', note: a.note };
    case 'skipped': return { chip: 'Skipped', tone: 'muted' };
    default: return { chip: 'Waiting', tone: 'muted' };
  }
}

/** The run's time and, once it has cost something, its credits. */
export function timeLabel(view: LiveRunView, now: number): string {
  const run = view.run!;
  let time = '';
  if (isFinished(run.status)) time = fmtDuration(run.durationMs ?? (run.completedAt ? Date.parse(run.completedAt) - Date.parse(run.startedAt) : null));
  else if (run.status === 'paused') {
    const since = Math.max(0, ...view.agents.map(a => (a.lastSignalAt ? Date.parse(a.lastSignalAt) : 0)));
    time = since ? `waiting ${fmtDuration(now - since)}` : '';
  } else time = fmtDuration(now - Date.parse(run.startedAt));
  const credits = run.credits;
  if (!credits) return time;
  const cost = `${credits} credit${credits === 1 ? '' : 's'}${run.status === 'failed' ? ' (failure rate)' : ''}`;
  return time ? `${time} · ${cost}` : cost;
}
