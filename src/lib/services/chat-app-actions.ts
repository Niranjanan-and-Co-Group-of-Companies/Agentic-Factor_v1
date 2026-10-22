// One-time jobs done in the Command Center chat, with the customer's connected apps — no mission needed.
//
//   Reading (inbox, invoices, records) runs straight away.
//   Creating and changing (a sheet, a doc, a CRM record) runs after the customer approves the plan.
//   Sending, posting, deleting, paying — what others see or can't be undone — runs exactly as shown on
//   the card: the server uses the approved content, so nothing (not even text read from an email) can
//   change it after the OK.

import { composioActionRisk } from './runtime/agent-loop';
import { appName } from '../utils/app-name';

export interface PlanStep {
  /** The app action, e.g. GOOGLESHEETS_CREATE_GOOGLE_SHEET1. */
  action: string;
  /** The app it belongs to (a connected toolkit), e.g. googlesheets. */
  toolkit: string;
  /** What it does, in the customer's words: "Create a sheet called Overdue invoices". */
  what: string;
  /** Sending, posting, deleting, paying: runs only with exactly these arguments. */
  exact: boolean;
  arguments?: Record<string, unknown>;
  /** The approved content, as shown on the card (exact steps). */
  preview?: Array<{ label: string; value: string }>;
}

export interface AppActionPlan { summary: string; steps: PlanStep[] }

/** What an approval allows, for the rest of the turn that carries it out. */
export interface Grant { steps: PlanStep[]; toolkits: Set<string>; used: Set<number> }

const str = { type: 'string' as const };

export const CHAT_APP_TOOLS = [
  {
    name: 'find_app_actions',
    description: 'Find the actions available in the customer\'s connected apps for something you want to do ("list unpaid invoices", "create a spreadsheet", "send an email"). Returns action slugs with their parameters. Use before read_app_data, propose_app_actions or do_app_action.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { ...str, description: 'What you want to do' }, toolkit: { ...str, description: 'Optional: one connected app, e.g. "googlesheets", "zoho_books"' } },
      required: ['query'] as string[],
    },
  },
  {
    name: 'read_app_data',
    description: 'Run a READ action (list, get, search, fetch) in a connected app and get its data. Runs straight away — reading changes nothing.',
    input_schema: {
      type: 'object' as const,
      properties: { action_slug: { ...str, description: 'Exact action slug from find_app_actions' }, arguments: { type: 'object' as const, description: 'The action\'s arguments' } },
      required: ['action_slug'] as string[],
    },
  },
  {
    name: 'read_app_api',
    description: 'GET from a connected app\'s own API when no read action fits. Read-only.',
    input_schema: {
      type: 'object' as const,
      properties: { toolkit: { ...str, description: 'App slug, e.g. "zoho_books"' }, path: { ...str, description: 'Path on the app\'s API' }, params: { type: 'object' as const, description: 'Query parameters' } },
      required: ['toolkit', 'path'] as string[],
    },
  },
  {
    name: 'propose_app_actions',
    description: 'Ask the customer\'s OK before anything that creates, changes, sends, posts, deletes or pays in their apps. Shows them a card with the steps; stop after calling it and wait. Each step: the action slug, what it does in plain words, and — for sending, posting, replying, deleting, paying or calendar invites — the exact arguments (recipients, subject, message…), because those run exactly as approved. Creating and updating steps may leave arguments out when they depend on earlier results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { ...str, description: 'One line: what will happen, e.g. "Create the Overdue invoices sheet and add 12 rows"' },
        steps: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: { action_slug: str, what: { ...str, description: 'Plain words: "Add the 12 invoices as rows"' }, arguments: { type: 'object' as const } },
            required: ['action_slug', 'what'],
          },
        },
      },
      required: ['summary', 'steps'] as string[],
    },
  },
  {
    name: 'do_app_action',
    description: 'Carry out a step the customer has approved (create, update, send…). Reads also work here. Anything not approved is refused — propose it first.',
    input_schema: {
      type: 'object' as const,
      properties: { action_slug: str, arguments: { type: 'object' as const } },
      required: ['action_slug'] as string[],
    },
  },
];

export const CHAT_APP_TOOL_NAMES = new Set(CHAT_APP_TOOLS.map(t => t.name));

/** The connected app an action belongs to: the longest connected slug it starts with (ZOHO_BOOKS_… is zoho_books). */
export function toolkitOf(action: string, connected: string[]): string {
  const upper = action.toUpperCase();
  const match = [...connected].sort((a, b) => b.length - a.length).find(t => upper.startsWith(`${t.toUpperCase()}_`));
  return (match ?? upper.split('_')[0]).toLowerCase();
}

// Fields worth showing on the card, in this order (recipients and content first).
const PREVIEW_KEYS = ['to', 'recipient_email', 'recipients', 'email', 'cc', 'bcc', 'channel', 'channel_id', 'chat_id', 'subject', 'title', 'name', 'text', 'body', 'message', 'content', 'description', 'amount', 'date', 'start_datetime', 'attendees', 'id', 'file_id', 'record_id'];

/** The approved content as label/value pairs: recipients, subject, message… (long values shortened). */
export function previewOf(args: Record<string, unknown> | undefined): Array<{ label: string; value: string }> {
  if (!args) return [];
  const show = (v: unknown) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 600 ? `${s.slice(0, 600)}…` : s;
  };
  const keys = Object.keys(args).filter(k => args[k] !== undefined && args[k] !== null && args[k] !== '');
  const ordered = [...PREVIEW_KEYS.filter(k => keys.includes(k)), ...keys.filter(k => !PREVIEW_KEYS.includes(k))].slice(0, 8);
  return ordered.map(k => ({ label: k.replace(/_/g, ' '), value: show(args[k]) }));
}

/** Checks a proposal from the assistant and turns it into the card's plan, or says what to fix. */
export function validatePlan(input: Record<string, unknown>, connected: string[]): { plan: AppActionPlan } | { error: string } {
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (!summary || rawSteps.length === 0) return { error: 'Give a one-line summary and at least one step.' };
  if (rawSteps.length > 12) return { error: 'At most 12 steps: split the job.' };
  const connectedSet = new Set(connected.map(c => c.toLowerCase()));
  const steps: PlanStep[] = [];
  for (const raw of rawSteps as Array<Record<string, unknown>>) {
    const action = String(raw.action_slug ?? '').trim().toUpperCase();
    const what = String(raw.what ?? '').trim();
    if (!/^[A-Z][A-Z0-9_]+$/.test(action) || !what) return { error: 'Each step needs an exact action slug and what it does.' };
    const toolkit = toolkitOf(action, connected);
    if (!connectedSet.has(toolkit)) return { error: `${appName(toolkit)} isn't connected: suggest connecting it (suggest_connector) instead.` };
    const risk = composioActionRisk(action);
    if (risk === 'read') continue; // reads need no OK
    const args = raw.arguments && typeof raw.arguments === 'object' && !Array.isArray(raw.arguments) ? raw.arguments as Record<string, unknown> : undefined;
    const exact = risk === 'write_irreversible';
    if (exact && (!args || Object.keys(args).length === 0)) {
      return { error: `"${what}" sends, posts or deletes: include its exact arguments (recipients, subject, message…) so the customer approves exactly what goes out.` };
    }
    steps.push({ action, toolkit, what, exact, ...(args ? { arguments: args } : {}), ...(exact ? { preview: previewOf(args) } : {}) });
  }
  if (steps.length === 0) return { error: 'Those steps only read: run them with read_app_data — no OK is needed.' };
  return { plan: { summary, steps } };
}

export function grantFor(plan: AppActionPlan): Grant {
  return { steps: plan.steps, toolkits: new Set(plan.steps.map(s => s.toolkit)), used: new Set() };
}

/**
 * Whether do_app_action may run this action now, and with which arguments. Approved sending/deleting
 * steps run with the approved arguments, whatever is passed now; creating and updating may run in the
 * approved apps; reads always may.
 */
export function checkDo(
  grant: Grant | null,
  action: string,
  args: Record<string, unknown>,
  connected: string[],
): { run: true; args: Record<string, unknown> } | { run: false; reason: string } {
  const slug = action.toUpperCase();
  const risk = composioActionRisk(slug);
  if (risk === 'read') return { run: true, args };
  if (!grant) return { run: false, reason: 'Not approved yet: propose it with propose_app_actions and wait for the customer\'s OK.' };
  const exactIndex = grant.steps.findIndex((s, i) => s.exact && s.action === slug && !grant.used.has(i));
  if (exactIndex !== -1) {
    grant.used.add(exactIndex);
    return { run: true, args: grant.steps[exactIndex].arguments ?? {} };
  }
  if (risk === 'write_irreversible') {
    return { run: false, reason: 'Sending, posting or deleting runs only exactly as approved: propose it with its exact arguments and wait.' };
  }
  const approvedApp = grant.steps.some(s => s.action === slug) || grant.toolkits.has(toolkitOf(slug, connected));
  return approvedApp
    ? { run: true, args }
    : { run: false, reason: `${appName(toolkitOf(slug, connected))} wasn't in the plan the customer approved: propose it first.` };
}

/** Told to the assistant with the customer's OK, so it carries out exactly that plan. */
export function approvalNote(plan: AppActionPlan): string {
  const lines = plan.steps.map((s, i) => `${i + 1}. ${s.action} — ${s.what}${s.exact ? ' (runs exactly as approved)' : ''}`);
  return `[The customer approved: ${plan.summary}\n${lines.join('\n')}\nCarry it out now with do_app_action, in order, then say what was done — with links to anything created.]`;
}
