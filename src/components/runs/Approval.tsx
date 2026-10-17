'use client';
// Approvals in the chat. ApprovalPanel asks for the decision (with an optional reason); ApprovalRecord
// is what stays in the mission's chat afterwards — who decided, how, when and why — wherever it was decided.

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown, CircleCheck, CircleX, ShieldCheck } from 'lucide-react';
import type { ApprovalRecordPayload, ApprovalVia } from '@/lib/services/approval-records';
import { kickLive } from './useLiveRun';
import s from './runs.module.css';

export type { ApprovalRecordPayload } from '@/lib/services/approval-records';

export interface ApprovalInfo {
  id: string;
  agentRole: string;
  kind: 'rehearsal' | 'live';
  actions: string[];
  preview?: string;
  submittedAt?: string;
  missionTitle?: string;
}

const VIA_TEXT: Record<ApprovalVia, string> = {
  mission_chat: 'in the mission chat',
  command_center: 'in Command Center',
  chat_message: 'by replying in the chat',
  approvals_page: 'on the Approvals page',
  api: 'through the API',
};

/** Tells every open view (Command Center list, mission chat) that approvals changed. */
function announceApprovalsChanged(missionId: string) {
  kickLive(missionId);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('af:approvals-changed'));
}

function FullPreview({ actionId, initial }: { actionId: string; initial?: string }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && full === null && !loading) {
      setLoading(true);
      try {
        const res = await fetch(`/api/approvals?id=${encodeURIComponent(actionId)}`, { credentials: 'include', cache: 'no-store' });
        const data = res.ok ? await res.json() as { approval?: { preview?: string } } : null;
        setFull(data?.approval?.preview ?? initial ?? '');
      } catch {
        setFull(initial ?? '');
      } finally {
        setLoading(false);
      }
    }
  };
  if (!initial) return null;
  return (
    <>
      {open
        ? <div className={s.previewFull}>{loading ? 'Loading…' : (full || initial)}</div>
        : <div className={s.preview}>{initial}</div>}
      <button type="button" className={s.textBtn} onClick={toggle} aria-expanded={open}>
        {open ? 'Show less' : 'Show full details'} <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : undefined }} aria-hidden />
      </button>
    </>
  );
}

interface PanelProps {
  approval: ApprovalInfo;
  missionId: string;
  via: 'mission_chat' | 'command_center';
  compact?: boolean;
  /** Called with the saved record once decided (also when it turns out to be decided already). */
  onDecided?: (record: ApprovalRecordPayload) => void;
}

/** The approval waiting on the customer: what it will do, and Approve / Reject with an optional reason. */
export function ApprovalPanel({ approval, missionId, via, compact = false, onDecided }: PanelProps) {
  const rehearsal = approval.kind === 'rehearsal';
  const [mode, setMode] = useState<'idle' | 'note' | 'reject'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: approval.id, decision, missionId, via, reason: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({})) as { record?: ApprovalRecordPayload; message?: string; error?: string; decision?: 'approved' | 'rejected'; providers?: string[] };
      if (res.ok || res.status === 409) {
        setDone(res.ok ? decision : data.decision ?? decision);
        if (data.record) onDecided?.(data.record);
        if (res.status === 409) setError(data.message ?? 'This was already decided.');
      } else if (res.status === 403 && data.providers) {
        setError(data.message ?? `Connect ${data.providers.join(', ')} first, then approve again.`);
      } else {
        setError(data.message ?? data.error ?? 'Could not record that. Please try again.');
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(null);
      announceApprovalsChanged(missionId);
    }
  };

  if (done && !error) {
    return (
      <div className={`${s.approval} ${done === 'approved' ? s.approvalOk : s.approvalNo}`} role="status">
        <div className={s.approvalTitle}>
          {done === 'approved' ? <CircleCheck size={15} aria-hidden /> : <CircleX size={15} aria-hidden />}
          {done === 'approved'
            ? (rehearsal ? 'Preview approved — finishing the rehearsal' : 'Approved — carrying it out now')
            : (rehearsal ? 'Preview rejected — the rehearsal is stopped' : 'Rejected — nothing was changed')}
        </div>
        <div className={s.approvalText}>Saved in this mission’s chat{note.trim() ? ', with your reason' : ''}.</div>
      </div>
    );
  }

  return (
    <div className={s.approval}>
      <div className={s.approvalTitle}>
        <ShieldCheck size={15} strokeWidth={2} aria-hidden />
        {rehearsal ? 'Here’s what it would do' : 'It wants to make these changes'}
      </div>
      <div className={s.approvalMeta}>
        {approval.missionTitle && <><span className={s.approvalMission}>{approval.missionTitle}</span> · </>}
        {approval.agentRole}
      </div>
      <div className={s.approvalText}>
        {rehearsal
          ? 'This is the rehearsal: nothing has been sent or changed. If it looks right, continue and the rehearsal finishes.'
          : 'These are real. Approve to let it go ahead, or reject to stop the run.'}
      </div>
      {approval.actions.length > 0 && (
        <div className={s.actions}>{approval.actions.map(act => <span key={act} className={s.action}>{act}</span>)}</div>
      )}
      {!compact && <FullPreview actionId={approval.id} initial={approval.preview} />}

      {mode !== 'idle' && (
        <textarea
          className={s.noteBox}
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={1000}
          rows={2}
          autoFocus
          placeholder={mode === 'reject'
            ? 'What’s wrong? (optional — the assistant uses this to fix the mission)'
            : 'Add a note for the record (optional)'}
          aria-label={mode === 'reject' ? 'Reason for rejecting' : 'Note for the record'}
        />
      )}

      <div className={s.buttons}>
        {mode === 'reject' ? (
          <>
            <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={() => decide('rejected')} disabled={!!busy}>
              {busy === 'rejected' ? 'Rejecting…' : (rehearsal ? 'Reject the preview' : 'Reject')}
            </button>
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => { setMode('idle'); setNote(''); }} disabled={!!busy}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => decide('approved')} disabled={!!busy}>
              {busy === 'approved' ? 'Approving…' : <>{rehearsal ? 'Looks right — continue' : 'Approve'} <ArrowRight size={14} aria-hidden /></>}
            </button>
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => setMode('reject')} disabled={!!busy}>
              {rehearsal ? 'Something’s wrong' : 'Reject'}
            </button>
            {mode === 'idle' && <button type="button" className={s.textBtn} onClick={() => setMode('note')} disabled={!!busy}>Add a note</button>}
          </>
        )}
      </div>
      {error && (
        <div className={s.approvalError} role="alert">
          {error}
          {error.startsWith('Connect ') && <> <Link href="/connectors">Open Connectors</Link></>}
        </div>
      )}
    </div>
  );
}

/** The decision as it stays in the mission's chat. */
export function ApprovalRecord({ record, onAsk, missionId, missionTitle }: {
  record: ApprovalRecordPayload;
  onAsk?: (text: string) => void;
  /** Shown outside the mission's own chat (Command Center): name it and link to its chat. */
  missionId?: string;
  missionTitle?: string;
}) {
  const approved = record.decision === 'approved';
  const rehearsal = record.kind === 'rehearsal';
  const when = new Date(record.decidedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const [open, setOpen] = useState(false);
  return (
    <div className={`${s.record} ${approved ? s.recordOk : s.recordNo}`}>
      <div className={s.recordHead}>
        {approved ? <CircleCheck size={17} className={s.recordIconOk} aria-hidden /> : <CircleX size={17} className={s.recordIconNo} aria-hidden />}
        <span className={s.recordTitle}>
          {approved ? (rehearsal ? 'Rehearsal preview approved' : 'Approved') : (rehearsal ? 'Rehearsal preview rejected' : 'Rejected')}
          <span className={s.recordAgent}> · {record.agentRole}</span>
        </span>
        <span className={s.recordWhen}>{when}</span>
      </div>
      {missionTitle && <div className={s.approvalMeta}>{missionTitle}</div>}
      {record.actions.length > 0 && (
        <div className={s.actions}>{record.actions.map(act => <span key={act} className={s.action}>{act}</span>)}</div>
      )}
      {record.reason && <blockquote className={s.recordReason}>{record.reason}</blockquote>}
      <div className={s.recordBy}>
        Decided{record.decidedBy ? ` by ${record.decidedBy}` : ''} {VIA_TEXT[record.via] ?? ''}
      </div>
      {record.preview && (
        <>
          {open && <div className={s.previewFull}>{record.preview}</div>}
          <button type="button" className={s.textBtn} onClick={() => setOpen(o => !o)} aria-expanded={open}>
            {open ? 'Hide details' : approved ? 'What was approved' : 'What was rejected'} <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : undefined }} aria-hidden />
          </button>
        </>
      )}
      {(onAsk && !approved) || missionId ? (
        <div className={s.buttons}>
          {onAsk && !approved && (
            <button
              type="button"
              className={`${s.btn} ${s.btnGhost}`}
              onClick={() => onAsk(`I rejected what "${record.agentRole}" wanted to do (${record.actions.join(', ') || 'its changes'})${record.reason ? ` because: ${record.reason}` : ''}. Please fix the mission so it gets this right next time.`)}
            >
              Ask the assistant to fix this
            </button>
          )}
          {missionId && <Link href={`/dashboard/missions/${missionId}/chat`} className={`${s.btn} ${s.btnGhost}`}>Open mission chat <ArrowRight size={14} aria-hidden /></Link>}
        </div>
      ) : null}
    </div>
  );
}

/** A saved chat message that is an approval record (from the server or added on the spot). */
export function recordOf(payload: unknown): ApprovalRecordPayload | null {
  return payload && typeof payload === 'object' && (payload as { type?: string }).type === 'approval_record'
    ? payload as ApprovalRecordPayload
    : null;
}
