'use client';
// What a chat button did, kept in the chat: "Applying…" while it works, then ✓ with the outcome or
// ✗ with the reason and a Retry. Saved entries come back from the history after a reload.

import Link from 'next/link';
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle, RotateCcw } from 'lucide-react';
import { resultTitle, type ActionResultEntry, type ResultKind } from '@/lib/services/chat-log';
import type { ThreadNote as ThreadNoteEntry } from '@/lib/services/build-jobs';
import s from './runs.module.css';

export type { ActionResultEntry, ResultKind } from '@/lib/services/chat-log';

const PENDING: Record<ResultKind, string> = {
  run: 'Starting the run', schedule: 'Setting the schedule', unschedule: 'Removing the schedule', pause: 'Pausing the mission',
  resume: 'Resuming the mission', go_live: 'Switching to live', connect: 'Connecting', webhook: 'Creating the webhook',
  revert: 'Reverting', update: 'Updating the mission',
};

export function PendingResult({ kind, label }: { kind: ResultKind; label: string }) {
  return (
    <div className={`${s.record} ${s.recordPending}`} role="status" aria-live="polite">
      <div className={s.recordHead}>
        <LoaderCircle size={16} className={s.spin} aria-hidden />
        <span className={s.recordTitle}>{PENDING[kind]}…<span className={s.recordAgent}> · {label}</span></span>
      </div>
    </div>
  );
}

export function ActionResult({ entry, onRetry, showMission = false }: {
  entry: ActionResultEntry;
  /** Offered on a failure when the action can be tried again. */
  onRetry?: () => void;
  /** Outside the mission's own chat: name the mission and link to it. */
  showMission?: boolean;
}) {
  const when = new Date(entry.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <div className={`${s.record} ${entry.ok ? s.recordOk : s.recordNo}`} role={entry.ok ? undefined : 'alert'}>
      <div className={s.recordHead}>
        {entry.ok ? <CircleCheck size={17} className={s.recordIconOk} aria-hidden /> : <CircleAlert size={17} className={s.recordIconNo} aria-hidden />}
        <span className={s.recordTitle}>{resultTitle(entry)}<span className={s.recordAgent}> · {entry.label}</span></span>
        <span className={s.recordWhen}>{when}</span>
      </div>
      {showMission && entry.missionTitle && <div className={s.approvalMeta}>{entry.missionTitle}</div>}
      {entry.detail && <div className={s.resultDetail}>{entry.detail}</div>}
      {!entry.ok && entry.error && <div className={s.resultError}>{entry.error}</div>}
      {entry.by && <div className={s.recordBy}>By {entry.by}</div>}
      {(onRetry || (showMission && entry.missionId)) && (
        <div className={s.buttons}>
          {!entry.ok && onRetry && (
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onRetry}>
              <RotateCcw size={13} aria-hidden /> Try again
            </button>
          )}
          {showMission && entry.missionId && (
            <Link href={`/dashboard/missions/${entry.missionId}/chat`} className={`${s.btn} ${s.btnGhost}`}>Open mission chat <ArrowRight size={14} aria-hidden /></Link>
          )}
        </div>
      )}
    </div>
  );
}

/** Where a conversation moved from Command Center into the mission's chat, and where the mission was created. */
export function ThreadNote({ note }: { note: ThreadNoteEntry }) {
  const when = new Date(note.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <div className={s.threadNote} role="note">
      <span className={s.threadLine} aria-hidden />
      <span className={s.threadText}>
        {note.kind === 'started' ? `Started in Command Center · ${when}` : `Mission created · ${when} · continue here`}
      </span>
      <span className={s.threadLine} aria-hidden />
    </div>
  );
}

/** A saved chat entry of a given kind (run card, action result, approval record, thread note), or null. */
export function entryType(payload: unknown): 'run_card' | 'action_result' | 'approval_record' | 'thread_note' | null {
  const t = payload && typeof payload === 'object' ? (payload as { type?: string }).type : undefined;
  return t === 'run_card' || t === 'action_result' || t === 'approval_record' || t === 'thread_note' ? t : null;
}
