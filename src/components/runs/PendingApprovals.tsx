'use client';
// Command Center: everything waiting on the customer's OK, across missions, decided right here.
// Each decision is saved into that mission's chat by the server.

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ApprovalSummary } from '@/lib/services/approval-records';
import { ApprovalPanel, type ApprovalRecordPayload } from './Approval';
import s from './runs.module.css';

export default function PendingApprovals({ onDecided }: { onDecided?: (record: ApprovalRecordPayload, approval: ApprovalSummary) => void }) {
  const [items, setItems] = useState<ApprovalSummary[]>([]);
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      if (timer) clearTimeout(timer);
      try {
        const res = await fetch('/api/approvals?pending=1', { credentials: 'include', cache: 'no-store' });
        if (res.ok && !stopped) setItems(((await res.json()) as { approvals?: ApprovalSummary[] }).approvals ?? []);
      } catch { /* keep the last list */ }
      if (!stopped) timer = setTimeout(load, document.visibilityState === 'hidden' ? 60_000 : 15_000);
    };
    void load();
    // A decision just made shows its outcome for a moment before the list refreshes.
    const onDecision = () => { if (timer) clearTimeout(timer); timer = setTimeout(load, 2500); };
    const onRuns = () => { if (timer) clearTimeout(timer); timer = setTimeout(load, 1500); };
    window.addEventListener('af:approvals-changed', onDecision);
    window.addEventListener('af:runs-changed', onRuns);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('af:approvals-changed', onDecision);
      window.removeEventListener('af:runs-changed', onRuns);
    };
  }, []);

  if (items.length === 0) return null;
  const visible = showAll ? items : items.slice(0, 2);
  const names = [...new Set(items.map(a => a.missionTitle))].slice(0, 2).join(' · ');

  return (
    <div className={s.pending}>
      <button type="button" className={s.pendingBar} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={s.pendingDot} aria-hidden />
        <span className={s.pendingCount}>{items.length === 1 ? '1 approval is waiting for you' : `${items.length} approvals are waiting for you`}</span>
        <span className={s.pendingNames}>{names}</span>
        <ChevronDown size={15} className={s.pendingChevron} style={{ transform: open ? 'rotate(180deg)' : undefined }} aria-hidden />
      </button>
      {open && (
        <div className={s.pendingList}>
          {visible.map(a => (
            <ApprovalPanel
              key={a.id}
              approval={{ id: a.id, agentRole: a.agentRole, kind: a.kind, actions: a.actions, preview: a.preview, missionTitle: a.missionTitle, submittedAt: a.submittedAt }}
              missionId={a.missionId}
              via="command_center"
              onDecided={record => onDecided?.(record, a)}
            />
          ))}
          {items.length > 2 && (
            <button type="button" className={s.textBtn} onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show fewer' : `Show ${items.length - 2} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
