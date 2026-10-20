// The shapes the API sends and receives — shared by the website (src/) and the mobile app (mobile/),
// so the two can never disagree about them. Types only: nothing here may import server or browser code.

// ── Live runs (GET /api/missions/:id/live) ──

export type RunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed';
export type AgentStep = 'waiting' | 'working' | 'repairing' | 'checking' | 'acting' | 'approval' | 'paused' | 'done' | 'failed' | 'skipped';

export interface LiveAgent {
  id: string;
  role: string;
  /** Composio toolkit slugs this agent's script calls, for its app logos. */
  apps: string[];
  step: AgentStep;
  /** Attempt number while repairing (2 = first repair). */
  attempt?: number;
  maxAttempts?: number;
  /** Short plain-language detail: the error being repaired, or why it stopped. */
  note?: string;
  startedAt?: string;
  finishedAt?: string;
  /** Time of the latest sign of life from this agent. */
  lastSignalAt?: string;
}

export interface LiveApproval {
  id: string;
  agentId: string;
  agentRole: string;
  /** rehearsal = a preview to check (nothing real happens); live = permission for a real action. */
  kind: 'rehearsal' | 'live';
  actions: string[];
  preview?: string;
  submittedAt?: string;
}

export interface LiveRun {
  id: string;
  number: number;
  status: RunStatus;
  mode: 'rehearsal' | 'live';
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  agentsTotal: number;
  agentsDone: number;
  agentsFailed: number;
  error?: string;
  summary?: string;
  /** Credits charged for this run so far (at the failure rate once it has failed). */
  credits?: number;
}

export interface LiveRunView {
  mission: { id: string; title: string; status: string; /** the next run is a rehearsal */ rehearsal: boolean };
  run: LiveRun | null;
  agents: LiveAgent[];
  approval: LiveApproval | null;
  /** Official name and logo of each app the agents use, from Composio's catalog. */
  apps: Record<string, { name: string; logo: string }>;
  /** Median duration of recent completed runs, for "usually ~25s". */
  typicalMs: number | null;
  serverTime: string;
}

// ── Approvals ──

export type ApprovalKind = 'rehearsal' | 'live';
export type ApprovalVia = 'mission_chat' | 'command_center' | 'chat_message' | 'approvals_page' | 'api';

export interface ApprovalSummary {
  id: string;
  missionId: string;
  missionTitle: string;
  agentId: string;
  agentRole: string;
  kind: ApprovalKind;
  /** The app actions it will run, e.g. "Gmail: send email". */
  actions: string[];
  /** The platform's own description of the calls and the prepared content. */
  preview: string;
  runId?: string;
  submittedAt?: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface ApprovalRecordPayload {
  type: 'approval_record';
  actionId: string;
  decision: 'approved' | 'rejected';
  kind: ApprovalKind;
  agentRole: string;
  actions: string[];
  preview?: string;
  reason?: string;
  via: ApprovalVia;
  decidedBy?: string;
  decidedAt: string;
  runId?: string;
}

// ── Entries saved into a chat (run cards, button results, approval decisions, thread notes) ──

export type ResultKind = 'run' | 'schedule' | 'unschedule' | 'pause' | 'resume' | 'go_live' | 'connect' | 'webhook' | 'revert' | 'update';

export interface RunCardEntry {
  type: 'run_card';
  runId: string;
  runNumber?: number;
  trigger?: string;
  missionId: string;
  missionTitle?: string;
}

export interface ActionResultEntry {
  type: 'action_result';
  kind: ResultKind;
  ok: boolean;
  /** What was asked for, e.g. "Every Monday 9am IST". */
  label: string;
  /** The outcome in a line, e.g. "Next run Mon 20 Oct, 9:00 am". */
  detail?: string;
  /** Why it failed. */
  error?: string;
  missionId?: string;
  missionTitle?: string;
  via?: 'mission_chat' | 'command_center';
  by?: string;
  at: string;
  /** The original chat action, so a failed one can be retried from the history. */
  action?: Record<string, unknown>;
}

export type ChatEntry = RunCardEntry | ActionResultEntry | (ApprovalRecordPayload & { missionId?: string; missionTitle?: string });

/** Where a conversation moved from Command Center into the mission's chat, and where the mission was created. */
export interface ThreadNote { type: 'thread_note'; kind: 'started' | 'created'; at: string; missionId?: string; missionTitle?: string }

// ── Chats (POST /api/command-chat, POST /api/missions/:id/chat) ──

/** An action card an assistant reply carries. Command Center and mission chat use different types. */
export interface ChatAction {
  type: string;
  [key: string]: unknown;
}

/** Command Center: what a card needs to run, schedule, open or connect. */
export interface CommandAction extends ChatAction {
  jobId?: string;
  missionId?: string;
  missionTitle?: string;
  missionStatus?: string;
  cron?: string;
  timezone?: string;
  label?: string;
  provider?: string;
  reason?: string;
  intent?: string;
  question?: string;
  error?: string;
  agents?: Array<{ name: string; icon?: string; role: string; tool?: string; trustLevel?: string }>;
  orchestrationPattern?: string;
  requiredConnectors?: Array<{ service: string; reason: string; connected: boolean }>;
  movedToChat?: boolean;
  credits?: number;
}

/** Mission chat: run, schedule, go live, update the mission… */
export interface MissionAction extends ChatAction {
  label?: string;
  cron?: string;
  timezone?: string;
  provider?: string;
  summary?: string;
  agents?: string[];
  executionMode?: 'sequential' | 'parallel';
  versionNumber?: number;
}

/** One event of a streamed chat reply. */
export interface ChatStreamEvent {
  type: 'delta' | 'done' | 'error' | 'tool_status' | 'proactive_alert' | 'agent_queued';
  text?: string;
  cleanText?: string;
  action?: ChatAction | null;
  sessionId?: string;
  messageId?: string | null;
  message?: string;
  detail?: string;
  proactiveAlert?: string;
  executionId?: string;
  approvalRecord?: ApprovalRecordPayload | null;
  name?: string;
  provider?: string;
  displayName?: string;
  status?: 'running' | 'done' | 'error';
  label?: string;
  summary?: string;
}

export interface ChatSession { id: string; title?: string; updated_at: string }

/** A saved chat message (POST …/sessions { sessionId } → { messages }). */
export interface SavedChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  action_payload: ChatAction | null;
  action_applied?: boolean;
  created_at: string;
}

// ── Building a mission (GET /api/blueprint-status?jobId=) ──

export interface BuildProgress { roles: string[]; ready: string[] }

export interface BlueprintStatus {
  status?: 'pending' | 'processing' | 'discovery' | 'completed' | 'failed';
  step?: string;
  question?: string;
  error?: string;
  progress?: BuildProgress;
  missionId?: string;
  missionTitle?: string;
  agents?: CommandAction['agents'];
  orchestrationPattern?: string;
  requiredConnectors?: CommandAction['requiredConnectors'];
  movedToChat?: boolean;
  credits?: number;
}

// ── Missions (GET /api/missions) ──

export interface MissionListItem {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// ── Billing for the app (GET /api/billing/store) ──

/** Where a paid plan is billed: an app store, the website (Razorpay), or by hand (enterprise). */
export type PlanBilledBy = 'app_store' | 'play_store' | 'test_store' | 'website' | 'other';

export interface StoreBillingStatus {
  plan: string;
  isTrial: boolean;
  /** Monthly plus top-up credits available now. */
  credits: number;
  billingStatus: string;
  periodEnd: string | null;
  /** null when on the free plan (or the plan has lapsed). */
  billedBy: PlanBilledBy | null;
  storeProductId: string | null;
  /** Payments recorded so far (packs and plan periods): goes up once a purchase has been applied. */
  payments: number;
  /** What the app sells, by store product id (prices come from the store). */
  products: StoreProductInfo[];
}

export interface StoreProductInfo {
  id: string;
  kind: 'pack' | 'plan';
  name: string;
  /** A pack's credits, or a plan's credits per month. */
  credits: number;
  maxActiveMissions?: number;
}
