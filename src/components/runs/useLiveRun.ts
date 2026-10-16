'use client';
// One poller per mission, shared by everything that shows its runs (the run card, the progress strip,
// the Command Center card), so they all show the same state at the same moment. It polls quickly while
// a run is going, slowly while it waits for an approval, and lazily when nothing is running.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { LiveRunView } from '@/lib/services/run-live';

export type { LiveRunView, LiveAgent, LiveRun, LiveApproval, AgentStep } from '@/lib/services/run-live';

export interface MissionLive {
  latest: LiveRunView | null;
  /** Last view seen of each run, so a card for an earlier run keeps its final state. */
  byRun: Record<string, LiveRunView>;
  /** Client clock when `latest` arrived, to tick timers without trusting the client's clock. */
  receivedAt: number;
}

interface Entry {
  state: MissionLive;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  inflight: boolean;
  fastUntil: number;
}

const entries = new Map<string, Entry>();
const EMPTY: MissionLive = { latest: null, byRun: {}, receivedAt: 0 };

function getEntry(missionId: string): Entry {
  let e = entries.get(missionId);
  if (!e) {
    e = { state: EMPTY, listeners: new Set(), timer: null, inflight: false, fastUntil: 0 };
    entries.set(missionId, e);
  }
  return e;
}

const isFinished = (status?: string) => status === 'completed' || status === 'failed';

async function fetchView(missionId: string, runId?: string): Promise<LiveRunView | null> {
  try {
    const res = await fetch(`/api/missions/${missionId}/live${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`, { credentials: 'include', cache: 'no-store' });
    return res.ok ? await res.json() as LiveRunView : null;
  } catch {
    return null;
  }
}

function delayFor(e: Entry): number {
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (Date.now() < e.fastUntil) return 1200;
  const status = e.state.latest?.run?.status;
  if (status === 'queued' || status === 'running') return hidden ? 6000 : 1500;
  if (status === 'paused') return hidden ? 20_000 : 4000;
  return hidden ? 60_000 : 15_000;
}

function schedule(missionId: string) {
  const e = entries.get(missionId);
  if (!e) return;
  if (e.timer) clearTimeout(e.timer);
  e.timer = e.listeners.size > 0 ? setTimeout(() => { void poll(missionId); }, delayFor(e)) : null;
}

function emit(e: Entry) {
  for (const l of e.listeners) l();
}

async function poll(missionId: string) {
  const e = getEntry(missionId);
  if (e.inflight) return;
  e.inflight = true;
  const prevRun = e.state.latest?.run;
  const view = await fetchView(missionId);
  e.inflight = false;
  if (view) {
    const byRun = { ...e.state.byRun };
    if (view.run) byRun[view.run.id] = view;
    e.state = { latest: view, byRun, receivedAt: Date.now() };
    emit(e);
    // A newer run took over before the last one's final state was seen: fetch that once, so its card ends right.
    if (prevRun && view.run && prevRun.id !== view.run.id && !isFinished(prevRun.status)) void loadRun(missionId, prevRun.id);
  }
  schedule(missionId);
}

async function loadRun(missionId: string, runId: string) {
  const view = await fetchView(missionId, runId);
  if (!view?.run) return;
  const e = getEntry(missionId);
  e.state = { ...e.state, byRun: { ...e.state.byRun, [runId]: view } };
  emit(e);
}

/** Poll now and quickly for a little while — after starting a run or answering an approval. */
export function kickLive(missionId: string) {
  const e = getEntry(missionId);
  e.fastUntil = Date.now() + 20_000;
  if (e.timer) clearTimeout(e.timer);
  void poll(missionId);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('af:runs-changed'));
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    for (const [id, e] of entries) if (e.listeners.size > 0) { if (e.timer) clearTimeout(e.timer); void poll(id); }
  });
}

/** The live state of a mission's runs; null until the first answer arrives. */
export function useMissionLive(missionId: string | null | undefined): MissionLive | null {
  const subscribe = useCallback((cb: () => void) => {
    if (!missionId) return () => {};
    const e = getEntry(missionId);
    e.listeners.add(cb);
    if (e.listeners.size === 1) void poll(missionId);
    return () => {
      e.listeners.delete(cb);
      if (e.listeners.size === 0 && e.timer) { clearTimeout(e.timer); e.timer = null; }
    };
  }, [missionId]);
  const state = useSyncExternalStore(
    subscribe,
    () => (missionId ? entries.get(missionId)?.state ?? EMPTY : EMPTY),
    () => EMPTY,
  );
  return state.receivedAt ? state : null;
}

/** One run's view: the latest when it is the latest, its last seen state otherwise (fetched once if unseen). */
export function useRunView(missionId: string, runId?: string | null): { view: LiveRunView | null; receivedAt: number } {
  const live = useMissionLive(missionId);
  const view = !live ? null
    : !runId ? live.latest
    : live.latest?.run?.id === runId ? live.latest
    : live.byRun[runId] ?? null;
  const missing = !!live && !!runId && !view;
  useEffect(() => { if (missing && runId) void loadRun(missionId, runId); }, [missing, missionId, runId]);
  return { view, receivedAt: live?.receivedAt ?? 0 };
}

/** Current time, ticking every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Missions with a run going right now ('running') or waiting on an approval ('approval'). */
export function useActiveRuns(): Record<string, 'running' | 'approval'> {
  const [active, setActive] = useState<Record<string, 'running' | 'approval'>>({});
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      if (timer) clearTimeout(timer);
      try {
        const res = await fetch('/api/runs/active', { credentials: 'include', cache: 'no-store' });
        if (res.ok && !stopped) setActive(((await res.json()) as { active: Record<string, 'running' | 'approval'> }).active ?? {});
      } catch { /* keep the last answer */ }
      if (!stopped) timer = setTimeout(load, document.visibilityState === 'hidden' ? 60_000 : 10_000);
    };
    void load();
    const onChange = () => { setTimeout(() => { void load(); }, 800); };
    window.addEventListener('af:runs-changed', onChange);
    return () => { stopped = true; if (timer) clearTimeout(timer); window.removeEventListener('af:runs-changed', onChange); };
  }, []);
  return active;
}
