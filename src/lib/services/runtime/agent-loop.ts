import { callLLM, generateEmbedding } from '../llm-router';
import { createServiceClient } from '@/lib/supabase/server';
import { Sandbox } from '@e2b/code-interpreter';
import { robustJSONParse } from '@/lib/utils/json-parser';
import { criticInputView, describeInputShape } from './pipeline-context';
import { createHash } from 'crypto';

const scriptHash = (code: string) => createHash('sha256').update(code).digest('hex').slice(0, 16);

interface AgentConfig {
  id: string;
  role: string;
  systemPrompt: string;
  tools: { name: string; type: string }[];
  handoffProtocol?: string;
  pythonScript?: string;
  trustLevel?: 'manual' | 'conditional' | 'autonomous';
}

/**
 * Sanitize LLM-generated Python code before execution.
 * Fixes common issues like unterminated string literals.
 */
// How long one execution of an agent script may run. E2B's runCode default is 60s, which killed
// scripts that write long documents with ask_ai. The sandbox outlives the script by setup time.
export const SCRIPT_TIMEOUT_MS = 90_000;
const SANDBOX_LIFETIME_MS = SCRIPT_TIMEOUT_MS + 60_000;
// An agent's attempts, critic review and live (Phase 2) execution all run inside one Inngest step,
// i.e. one 300s serverless invocation; stay under it.
const STEP_BUDGET_MS = 285_000;

/** Create an E2B sandbox with automatic retry on transient infrastructure failures. */
async function createSandboxWithRetry(timeoutMs: number, maxAttempts = 3): Promise<InstanceType<typeof Sandbox>> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await Sandbox.create({ apiKey: process.env.E2B_API_KEY, timeoutMs });
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message ?? '';
      const isInfra = /e2b|timeout|connect|network|ECONNRESET|503|502|unavailable/i.test(msg);
      if (!isInfra || attempt === maxAttempts) throw err;
      console.warn(`[E2B] Sandbox.create failed (attempt ${attempt}/${maxAttempts}), retrying in ${attempt * 2}s:`, msg);
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
  throw lastErr;
}

/**
 * The Python code in an LLM reply's fenced block. The closing fence must sit on its own line: scripts
 * often strip ``` fences from AI output (text.startswith("```")), and a lazy match up to the first
 * ``` cut those scripts off mid-line — the truncated script then failed every retry.
 */
export function extractPythonBlock(reply: string): string | null {
  const PYTHON_FENCE = /^[ \t]*```[ \t]*(?:python|py)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/m;
  const ANY_FENCE = /^[ \t]*```[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/m;
  const fenced = reply.match(PYTHON_FENCE) ?? reply.match(ANY_FENCE);
  if (fenced) return fenced[1];
  const loose = reply.match(/```(?:python|py)?\s*\n([\s\S]*?)```/);
  return loose ? loose[1] : null;
}

/** Where a single-quoted or double-quoted string opened on this line is still open at its end, if any. */
function openStringAtEndOfLine(line: string): { quote: '"' | "'"; start: number } | null {
  let quote: '"' | "'" | null = null;
  let start = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;               // skip the escaped character
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '#') return null;            // the rest is a comment
    if (c === '"' || c === "'") {
      if (line.startsWith(c.repeat(3), i)) return null; // triple quotes are handled by the caller
      quote = c;
      start = i;
    }
  }
  return quote ? { quote, start } : null;
}

export function sanitizePythonCode(code: string): string {
  // Fix 0: Strip null bytes and other non-printable characters that crash Python's parser
  // Python hard-rejects \x00 with: "source code string cannot contain null bytes"
  code = code.replace(/\x00/g, '');
  // Also strip other non-printable chars (except \n, \r, \t which are valid in source)
  code = code.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Fix 1: Replace unterminated single/double-quoted strings that span multiple lines
  // Pattern: a line ending with an opening quote and string content but no closing quote
  const lines = code.split('\n');
  const fixedLines: string[] = [];
  let i = 0;
  // Triple-quoted strings are valid multi-line Python (and what the codegen prompt asks for);
  // the single-quote heuristic below would read `x = """` as unterminated and corrupt it.
  let openTriple: '"""' | "'''" | null = null;

  while (i < lines.length) {
    const line = lines[i];

    const triples = line.match(/"""|'''/g) ?? [];
    if (openTriple || triples.length > 0) {
      for (const t of triples) {
        if (!openTriple) openTriple = t as '"""' | "'''";
        else if (t === openTriple) openTriple = null;
      }
      fixedLines.push(line);
      i++;
      continue;
    }

    // Detect a line that opens a single-line string and doesn't close it. Scanning the line keeps
    // track of which quote is open: counting quote characters treated the '"' in .strip('"').strip("'")
    // as an open string and glued the following lines into a triple-quoted block, corrupting valid code.
    const open = openStringAtEndOfLine(line);

    if (open) {
      const prefix = line.slice(0, open.start);
      const quote = open.quote;
      const startContent = line.slice(open.start + 1);
      {
        // A string opened on this line runs onto the next lines: rejoin it as a triple-quoted string
        // Collect continuation lines until we find the closing quote
        const contentLines = [startContent];
        let j = i + 1;
        let closed = false;
        
        while (j < lines.length && j - i < 20) { // Max 20 lines lookahead
          const nextLine = lines[j];
          const closeIdx = nextLine.indexOf(quote);
          
          if (closeIdx !== -1) {
            // Found closing quote — reconstruct with triple quotes
            contentLines.push(nextLine.substring(0, closeIdx));
            const remainder = nextLine.substring(closeIdx + 1);
            const tripleQuote = quote.repeat(3);
            fixedLines.push(`${prefix}${tripleQuote}${contentLines.join('\n')}${tripleQuote}${remainder}`);
            closed = true;
            i = j + 1;
            break;
          }
          contentLines.push(nextLine);
          j++;
        }
        
        if (!closed) {
          // Couldn't find closing quote — just escape the newline
          fixedLines.push(line);
          i++;
        }
        continue;
      }
    }
    
    fixedLines.push(line);
    i++;
  }
  
  return fixedLines.join('\n');
}

// The retry fixer is prompted with this text, so the original error must survive translation —
// a friendly summary alone ("Cannot reach the external API") leaves it nothing to fix.
export function translateAgentError(error: string, agentRole: string): string {
  const friendly = friendlyAgentError(error, agentRole);
  return friendly === error || friendly.includes('Original:')
    ? friendly
    : `${friendly}\nOriginal error: ${error.slice(0, 800)}`;
}

function friendlyAgentError(error: string, agentRole: string): string {
  // The platform's web-search plan is used up — no script change can fix this, so say what it is.
  if (/tavily/i.test(error) && /\b432\b/.test(error)) {
    return (
      `Web search unavailable in agent "${agentRole}": the platform's web-search quota (Tavily) has been used up. ` +
      `Research steps will fail until the search plan is topped up.`
    );
  }
  // A critic rejection is already a plain-English reason. Matching its text against the HTTP rules
  // below turned one (it mentioned a count of 401) into "OAuth token expired — reconnect the account".
  if (error.startsWith('Output failed critic review')) return error;
  // LinkedIn-specific 403 — most common cause of failed social missions
  if (
    (error.toLowerCase().includes('linkedin') || error.includes('ugcPosts') || error.includes('linkedin.com')) &&
    (error.includes('403') || error.toLowerCase().includes('forbidden'))
  ) {
    return (
      `LinkedIn 403 Forbidden: Your LinkedIn Developer App needs "Share on LinkedIn" product approval. ` +
      `Visit developer.linkedin.com → Your App → Products and request it (3–7 day review). ` +
      `Original: ${error}`
    );
  }
  // Generic 403
  if (/\b403\b/.test(error) || error.toLowerCase().includes('forbidden')) {
    return (
      `Permission denied (403) in agent "${agentRole}": The OAuth token lacks the required scope. ` +
      `Go to the Connectors page and reconnect the account with the correct permissions.`
    );
  }
  // 401
  if (/\b401\b/.test(error) || error.toLowerCase().includes('unauthorized')) {
    return (
      `Authentication failed (401) in agent "${agentRole}": The OAuth token has expired or been revoked. ` +
      `Go to the Connectors page and reconnect the account.`
    );
  }
  // Rate limit
  if (
    error.includes('429') ||
    error.toLowerCase().includes('rate limit') ||
    error.toLowerCase().includes('too many requests')
  ) {
    return `Rate limited (429): Too many requests to this API. Wait a few minutes before retrying the mission.`;
  }
  // Network errors
  if (
    error.toLowerCase().includes('econnrefused') ||
    error.toLowerCase().includes('econnreset') ||
    error.toLowerCase().includes('fetch failed') ||
    error.toLowerCase().includes('failed to fetch')
  ) {
    return (
      `Network error in agent "${agentRole}": Cannot reach the external API. ` +
      `Check that your credentials are valid and the service is online.`
    );
  }
  // E2B timeout
  if (error.toLowerCase().includes('timed out') || error.toLowerCase().includes('timeout')) {
    return (
      `Timeout (${SCRIPT_TIMEOUT_MS / 1000}s) in agent "${agentRole}": The script ran too long. ` +
      `The external API may be slow or unresponsive. ` +
      `Try reducing the data fetch scope in the mission description.`
    );
  }
  // No output
  if (
    error.includes('produced no output') ||
    error.includes('Script succeeded but produced no output')
  ) {
    return (
      `No output from agent "${agentRole}": The script ran successfully but printed nothing to stdout. ` +
      `Ensure the script ends with: print(json.dumps(result))`
    );
  }
  // Empty data cascade (already formatted)
  if (error.includes('EMPTY_DATA_CASCADE')) return error;
  // Preflight failure (already formatted)
  if (error.includes('PREFLIGHT_FAILED')) return error;
  // Insufficient credits
  if (error.includes('InsufficientCredits') || error.includes('Insufficient credits')) {
    return `Out of credits mid-mission. Purchase a top-up pack from your dashboard to continue.`;
  }
  // E2B execution error — extract the useful Python exception
  if (error.includes('E2B execution error:')) {
    const match = error.match(/E2B execution error: (\w+Error): ([^\n]+)/);
    if (match) return `Script error (${match[1]}) in agent "${agentRole}": ${match[2].trim()}`;
  }
  return error;
}

function isTransientError(errorMsg: string): boolean {
  if (!errorMsg) return false;
  const lower = errorMsg.toLowerCase();
  return (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes(' 500') ||
    lower.includes(' 502') ||
    lower.includes(' 503') ||
    (lower.includes('e2b') && lower.includes('failed to start'))
  );
}

// ── ACTION RISK CLASSIFIER ──────────────────────────────────────────────
// Explicit, maintained map of SDK call patterns → risk tier. Replaces a
// flat "is this a write op" boolean with three tiers so callers can tell
// apart agents that never need a human in the loop (read), agents whose
// output can be undone if wrong (write_reversible), and agents whose
// action can't be meaningfully undone once it fires (write_irreversible).
export type ActionRisk = 'read' | 'write_reversible' | 'write_irreversible';

const ACTION_PATTERNS: { pattern: string; risk: ActionRisk }[] = [
  // Irreversible — communications & public actions (someone outside the
  // system sees or receives the result; can't be unsent/unposted)
  { pattern: 'gmail.send', risk: 'write_irreversible' },
  { pattern: 'api.slack_send', risk: 'write_irreversible' },
  { pattern: 'social.post_linkedin', risk: 'write_irreversible' },
  { pattern: 'api.linkedin_post', risk: 'write_irreversible' },
  { pattern: 'social.post_tweet', risk: 'write_irreversible' },
  { pattern: 'social.post_facebook', risk: 'write_irreversible' },
  { pattern: 'social.post_instagram', risk: 'write_irreversible' },
  { pattern: 'social.post_to_all', risk: 'write_irreversible' },
  { pattern: 'calendar.create', risk: 'write_irreversible' },
  { pattern: 'notify_user', risk: 'write_irreversible' },

  // Irreversible — destructive or financial
  { pattern: 'social.delete_tweet', risk: 'write_irreversible' },
  { pattern: 'social.delete_linkedin_post', risk: 'write_irreversible' },
  { pattern: 'social.delete_facebook_post', risk: 'write_irreversible' },
  { pattern: '_request("DELETE"', risk: 'write_irreversible' },
  { pattern: 'requests.delete', risk: 'write_irreversible' },

  // Reversible — creates/updates a private resource the user can edit or delete
  { pattern: 'sheets.create', risk: 'write_reversible' },
  { pattern: 'sheets.update', risk: 'write_reversible' },
  { pattern: 'sheets.append', risk: 'write_reversible' },
  { pattern: 'drive.upload', risk: 'write_reversible' },
  { pattern: 'gmail.draft', risk: 'write_reversible' }, // draft only, not sent
  { pattern: 'api.github_create_issue', risk: 'write_reversible' },
  { pattern: 'api.notion_create_page', risk: 'write_reversible' },
  { pattern: '_request("PUT"', risk: 'write_reversible' },
  { pattern: '_request("PATCH"', risk: 'write_reversible' },
  { pattern: 'requests.put', risk: 'write_reversible' },
  { pattern: 'requests.patch', risk: 'write_reversible' },
  { pattern: 'ask_user', risk: 'write_reversible' }, // a check-in question, not an external action
];

// Providers whose write actions are almost always "send/post something to
// someone" rather than "create a private resource you can delete" — for
// these, default any non-GET generic api.call() to irreversible, since the
// HTTP method alone (e.g. POST) doesn't distinguish "send an email" from
// "create a doc" the way it might for a storage/productivity provider.
const COMMUNICATION_PROVIDERS = new Set([
  'gmail', 'slack', 'linkedin', 'twitter', 'facebook', 'instagram',
  'sendgrid', 'whatsapp', 'messenger', 'discord', 'telegram',
]);

// Endpoint-path keywords that indicate a send/publish regardless of provider
// or HTTP verb — this is the backstop for providers like "google" that cover
// many different APIs (Gmail send vs. Docs create) under one provider name,
// so a provider-only default would either over- or under-trigger.
const SEND_PATH_KEYWORDS = ['send', 'publish', 'notifications', 'broadcast'];

// api.call(provider, method, endpoint, ...) and the generic requests.post/
// _request("POST") are method-agnostic helpers — risk depends on what's
// actually being called, not just the function name, so these are
// classified by inspecting the provider and endpoint at the call site
// rather than a flat substring match on the wrapper name.
function classifyGenericCalls(code: string): ActionRisk[] {
  const risks: ActionRisk[] = [];
  const apiCallRegex = /api\.call\(\s*['"]([^'"]+)['"]\s*,\s*['"](GET|POST|PUT|PATCH|DELETE)['"](?:\s*,\s*['"]([^'"]*)['"])?/gi;
  let m: RegExpExecArray | null;
  while ((m = apiCallRegex.exec(code)) !== null) {
    const provider = m[1].toLowerCase();
    const method = m[2].toUpperCase();
    const endpoint = (m[3] || '').toLowerCase();

    if (method === 'GET') {
      risks.push('read');
      continue;
    }
    if (method === 'DELETE') {
      risks.push('write_irreversible');
      continue;
    }
    const looksLikeSend = SEND_PATH_KEYWORDS.some(kw => endpoint.includes(kw));
    if (looksLikeSend || COMMUNICATION_PROVIDERS.has(provider)) {
      risks.push('write_irreversible');
    } else {
      risks.push('write_reversible'); // POST/PUT/PATCH that creates/updates a private resource
    }
  }
  if (code.includes('requests.post') || code.includes('_request("POST"')) {
    risks.push('write_reversible');
  }
  return risks;
}

// Mirrors _is_composio_read in the sandbox SDK so this gate and the dry-run agree on what a read is:
// some word after the app prefix is a read verb and none is a write verb. (Checking only the second
// word misread slugs like GOOGLECALENDAR_EVENTS_LIST as irreversible writes.)
const COMPOSIO_READ_VERBS = new Set([
  'GET', 'LIST', 'SEARCH', 'FIND', 'FETCH', 'READ', 'CHECK', 'VIEW', 'QUERY',
  'RETRIEVE', 'SHOW', 'DESCRIBE', 'LOOKUP', 'COUNT', 'DOWNLOAD', 'EXPORT', 'WHO',
]);
const COMPOSIO_WRITE_VERBS = new Set([
  'CREATE', 'UPDATE', 'DELETE', 'REMOVE', 'SEND', 'SENDS', 'POST', 'PUT', 'PATCH', 'ADD', 'INSERT',
  'APPEND', 'UPLOAD', 'MOVE', 'COPY', 'RENAME', 'SET', 'MERGE', 'PUBLISH', 'REPLY', 'FORWARD', 'TRASH',
  'ARCHIVE', 'UNARCHIVE', 'INVITE', 'SHARE', 'STAR', 'UNSTAR', 'MARK', 'LABEL', 'MODIFY', 'EDIT',
  'REPLACE', 'CLEAR', 'EXECUTE', 'RUN', 'TRIGGER', 'CANCEL', 'CLOSE', 'LOCK', 'UNLOCK', 'ASSIGN',
  'UNASSIGN', 'ENABLE', 'DISABLE', 'APPROVE', 'DISMISS', 'SUBMIT', 'SCHEDULE', 'UPSERT', 'WRITE',
  'IMPORT', 'DUPLICATE', 'TRANSFER', 'PAY', 'CHARGE', 'REFUND', 'FOLLOW', 'UNFOLLOW', 'BLOCK', 'UNBLOCK',
  'MUTE', 'UNMUTE', 'PIN', 'UNPIN', 'REACT', 'COMMENT', 'TWEET', 'RETWEET', 'LIKE', 'UNLIKE', 'ACCEPT',
  'DECLINE', 'JOIN', 'LEAVE', 'KICK', 'BAN', 'RESTORE', 'RESET', 'REVOKE', 'GRANT', 'SYNC',
]);

// Write words that are nouns in context: Notion's "block", a workflow "run". Kept narrow — this
// decides what needs approval — so only a following noun, or a determiner after a leading read verb.
const COMPOSIO_NOUN_FOLLOWERS = new Set(['CONTENTS', 'CONTENT', 'CHILDREN', 'CHILD', 'ID', 'IDS', 'INFO', 'DETAILS', 'LOGS', 'HISTORY', 'ARTIFACTS', 'JOBS']);
const COMPOSIO_DETERMINERS = new Set(['A', 'AN', 'THE', 'ALL', 'EACH', 'WORKFLOW']);
export function isComposioRead(slug: string): boolean {
  const words = slug.toUpperCase().split('_').slice(1);
  const nounBefore = (i: number) => COMPOSIO_NOUN_FOLLOWERS.has(words[i + 1] ?? '');
  const firstVerb = words.find((w, i) => COMPOSIO_READ_VERBS.has(w) || (COMPOSIO_WRITE_VERBS.has(w) && !nounBefore(i)));
  const leadsWithRead = !!firstVerb && COMPOSIO_READ_VERBS.has(firstVerb);
  const isWrite = (w: string, i: number) => COMPOSIO_WRITE_VERBS.has(w) && !nounBefore(i) &&
    !(leadsWithRead && i > 0 && COMPOSIO_DETERMINERS.has(words[i - 1]));
  return leadsWithRead && !words.some(isWrite);
}
const COMPOSIO_IRREVERSIBLE_TOKENS = new Set([
  'SEND', 'SENDS', 'POST', 'PUBLISH', 'REPLY', 'FORWARD', 'DELETE', 'REMOVE', 'TRASH',
  'INVITE', 'SHARE', 'BROADCAST', 'TWEET', 'RETWEET', 'COMMENT', 'MERGE',
  'CHARGE', 'REFUND', 'PAY', 'TRANSFER', 'CANCEL',
]);
// Apps where a write is almost always visible to someone else.
const COMPOSIO_COMMS_PREFIXES = new Set([
  'GMAIL', 'OUTLOOK', 'SLACK', 'MICROSOFTTEAMS', 'DISCORD', 'WHATSAPP', 'TELEGRAM', 'SENDGRID',
  'LINKEDIN', 'TWITTER', 'FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'REDDIT',
]);
const COMPOSIO_PRIVATE_TOKENS = new Set(['DRAFT', 'LABEL', 'LABELS', 'MARK', 'STAR']);

// composio_proxy(toolkit, method, path, ...) calls an app's own API through its Composio connection.
const PROXY_CALL = /composio_proxy\(\s*["']([A-Za-z0-9_]+)["']\s*,\s*["']([A-Za-z]+)["'](?:\s*,\s*f?["']([^"']*)["'])?/g;
const PROXY_SEND_KEYWORDS = [...SEND_PATH_KEYWORDS, 'email', 'mail', 'message', 'sms', 'whatsapp'];

function classifyProxyCalls(code: string): ActionRisk[] {
  const totalCalls = (code.match(/composio_proxy\s*\(/g) ?? []).length;
  if (totalCalls === 0) return [];
  const risks: ActionRisk[] = [];
  let literalCalls = 0;
  for (const m of code.matchAll(PROXY_CALL)) {
    literalCalls++;
    const method = m[2].toUpperCase();
    // The path only — a query like ?send=false says the call does NOT send.
    const path = (m[3] ?? '').toLowerCase().split('?')[0];
    if (method === 'GET' || method === 'HEAD') risks.push('read');
    else if (method === 'DELETE' || PROXY_SEND_KEYWORDS.some(k => path.includes(k)) || COMMUNICATION_PROVIDERS.has(m[1].toLowerCase())) risks.push('write_irreversible');
    else risks.push('write_reversible');
  }
  // A method or toolkit passed in a variable can't be classified statically — require review.
  if (totalCalls > literalCalls) risks.push('write_reversible');
  return risks;
}

/** Proxy writes as approval-card labels ("ZOHO_BOOKS POST /invoices"). */
export function proxyWriteLabels(code: string): string[] {
  return [...code.matchAll(PROXY_CALL)]
    .filter(m => !['GET', 'HEAD'].includes(m[2].toUpperCase()))
    .map(m => `${m[1].toUpperCase()} ${m[2].toUpperCase()} ${m[3] ?? ''}`.trim());
}

function classifyComposioCalls(code: string): ActionRisk[] {
  const totalCalls = (code.match(/composio_execute\s*\(/g) ?? []).length;
  if (totalCalls === 0) return [];
  const risks: ActionRisk[] = [];
  const literal = /composio_execute\s*\(\s*["']([A-Za-z][A-Za-z0-9_]+)["']/g;
  let m: RegExpExecArray | null;
  let literalCalls = 0;
  while ((m = literal.exec(code)) !== null) {
    literalCalls++;
    const parts = m[1].toUpperCase().split('_');
    if (isComposioRead(m[1])) { risks.push('read'); continue; }
    const prefix = parts[0];
    const irreversible =
      parts.some(p => COMPOSIO_IRREVERSIBLE_TOKENS.has(p)) ||
      prefix === 'GOOGLECALENDAR' || // event writes email the attendees
      (COMPOSIO_COMMS_PREFIXES.has(prefix) && !parts.some(p => COMPOSIO_PRIVATE_TOKENS.has(p)));
    risks.push(irreversible ? 'write_irreversible' : 'write_reversible');
  }
  // composio_execute(action_var, ...) can't be classified statically — require review.
  if (totalCalls > literalCalls) risks.push('write_reversible');
  return risks;
}

export function classifyAgentActions(code: string): { hasWriteOps: boolean; writeRisk: ActionRisk } {
  const matchedRisks: ActionRisk[] = ACTION_PATTERNS
    .filter(({ pattern }) => code.includes(pattern))
    .map(({ risk }) => risk);
  matchedRisks.push(...classifyGenericCalls(code));
  matchedRisks.push(...classifyComposioCalls(code));
  matchedRisks.push(...classifyProxyCalls(code));

  const writeRisk: ActionRisk = matchedRisks.includes('write_irreversible')
    ? 'write_irreversible'
    : matchedRisks.includes('write_reversible')
      ? 'write_reversible'
      : 'read';

  return { hasWriteOps: writeRisk !== 'read', writeRisk };
}

// ── PHASE 2: REAL SIDE EFFECTS ──────────────────────────────────────────
// Executes the validated pythonCode for real (no AF_DRY_RUN), merging Phase 1
// artifacts into the result. Throws on any failure so the caller's retry loop
// can surface the real error — silently returning Phase 1's dry-run output
// would make the mission appear successful when nothing actually happened.
// Extracted into its own function so the resume-after-approval path can
// invoke real execution for the first time at resume — previously the
// stored payload was already the result of a real run that happened BEFORE
// the human ever saw it, which defeats the point of asking for approval.
async function runRealSideEffects(
  pythonCode: string,
  sandboxEnvs: Record<string, string>,
  dryRunOutputJSON: string,
  agentId: string,
  tenantId: string
): Promise<string> {
  let finalOutputJSON = dryRunOutputJSON;
  console.log(`[Agent ${agentId}] Phase 2: Executing real side effects...`);
  try {
    // Charge for Phase 2 sandbox before spinning it up
    const { deductCredits, CREDIT_COSTS } = await import('@/lib/middleware/billing');
    await deductCredits(tenantId, CREDIT_COSTS.code_execution, `e2b_phase2_realrun:${agentId}`).catch(
      (e: any) => console.warn(`[Agent ${agentId}] Phase 2 credit deduction failed (non-fatal):`, e.message)
    );

    const finalEnvs = { ...sandboxEnvs };
    delete finalEnvs['AF_DRY_RUN'];

    const finalSandbox = await createSandboxWithRetry(SANDBOX_LIFETIME_MS);

    try {
      const phase2Pkgs = getRequiredPackages(pythonCode);
      const phase2PipCmd = `import subprocess, sys; subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "--prefer-binary", "--no-cache-dir", "--disable-pip-version-check"] + ${JSON.stringify(phase2Pkgs)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)`;
      await finalSandbox.runCode(phase2PipCmd, { envs: finalEnvs });

      const { getSDKFiles } = await import('@/lib/sandbox/sdk-loader');
      const sdkFiles2 = getSDKFiles();
      for (const [filename, content] of Object.entries(sdkFiles2)) {
        try {
          await finalSandbox.files.write(`/home/user/agenticfactor/${filename}`, content);
        } catch {
          // non-fatal
        }
      }
      await finalSandbox.runCode('import sys; sys.path.insert(0, "/home/user")', { envs: finalEnvs });

      const finalWrapped = `import os, sys, json, base64
try:
    _b64 = os.environ.get('INPUT_CONTEXT_B64', '')
    _input = base64.b64decode(_b64).decode('utf-8') if _b64 else '{}'
    os.environ['INPUT_CONTEXT'] = _input
    try:
        _input_data = json.loads(_input, strict=False)
    except:
        cleaned = ''.join(c if ord(c) > 31 or c in '\\n\\r\\t' else ' ' for c in _input)
        try:
            _input_data = json.loads(cleaned)
        except:
            _input_data = {}
except:
    _input = '{}'
    _input_data = {}
    os.environ['INPUT_CONTEXT'] = '{}'

import time as _af_time
try:
    _af_time.tzset()
except Exception:
    pass
import matplotlib
matplotlib.use('Agg')

${pythonCode}`.replace(/\x00/g, '');

      const finalExec = await finalSandbox.runCode(finalWrapped, { envs: finalEnvs, timeoutMs: SCRIPT_TIMEOUT_MS });
      const finalStdout = finalExec.logs.stdout.join('\n').trim();

      if (finalExec.error) {
        throw new Error(`Phase 2 real execution failed: ${finalExec.error.value}`);
      }
      // Writes that failed even though the script caught the error and carried on.
      const failedWrites = parseWriteFailures(finalExec.logs.stderr.join('\n'));
      if (failedWrites.length > 0) {
        throw new Error(`Phase 2: ${failedWrites.length} write(s) failed — ${failedWrites.slice(0, 5).map(f => `${f.action}: ${f.error}`).join(' | ')}`);
      } else {
        console.log(`[Agent ${agentId}] Phase 2: Side effects executed successfully.`);
        const cleanFinalStdout = finalStdout.split('\n').filter(line => !line.startsWith('__SIGNAL__:')).join('\n').trim();
        if (cleanFinalStdout) {
          // Scripts usually catch API errors and print {"status": "failed", "error": ...}; that is a
          // failed write, not a successful run, so surface it for the retry fixer instead of returning it.
          let realFailure: string | null = null;
          try { realFailure = reportedFailure(robustJSONParse(cleanFinalStdout)); } catch { /* not JSON */ }
          if (realFailure) throw new Error(`Phase 2 real execution reported failure: ${realFailure}`);
          try {
            const parsed2 = robustJSONParse(cleanFinalStdout);
            const parsed1 = JSON.parse(dryRunOutputJSON);
            if (parsed1._artifacts) {
              parsed2._artifacts = parsed1._artifacts;
            }
            finalOutputJSON = JSON.stringify(parsed2);
            console.log(`[Agent ${agentId}] Phase 2 output replaced dry-run output with real data.`);
          } catch {
            console.warn(`[Agent ${agentId}] Phase 2 output not JSON, keeping Phase 1 output.`);
          }
        }
      }
    } finally {
      await finalSandbox.kill().catch(() => {});
    }
  } catch (phase2Err: any) {
    throw phase2Err;
  }
  return finalOutputJSON;
}

/**
 * Live writes the SDK reported as failed (`__AF_WRITE_FAILED__:{json}` on stderr). Scripts often catch
 * the error and carry on: a bookkeeping step 404'd on every invoice and bill and still showed as complete.
 */
export function parseWriteFailures(stderr: string): Array<{ action: string; error: string }> {
  const failures: Array<{ action: string; error: string }> = [];
  for (const line of stderr.split('\n')) {
    const at = line.indexOf('__AF_WRITE_FAILED__:');
    if (at === -1) continue;
    try {
      const f = JSON.parse(line.slice(at + '__AF_WRITE_FAILED__:'.length));
      if (typeof f?.action === 'string') failures.push({ action: f.action, error: String(f.error ?? '') });
    } catch { /* truncated line */ }
  }
  return failures;
}

// A top-level status of exactly "failed"/"error" means the script caught an API error itself.
// ("failed:no_recipients"-style statuses are legitimate outcomes and are not matched.)
export function reportedFailure(output: unknown): string | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const o = output as Record<string, unknown>;
  const isFailure = (v: unknown) => typeof v === 'string' && ['failed', 'error'].includes(v.trim().toLowerCase());
  // A step-level status counts too: a Doc created but its email failing reported
  // {"status": "created", "email_status": "failed"} and the run showed as completed.
  const failedKey = ['status', ...Object.keys(o).filter(k => k !== 'status' && k.endsWith('_status'))].find(k => isFailure(o[k]));
  if (!failedKey) return null;
  const detail = o.error ?? o.message ?? o.reason;
  return typeof detail === 'string' ? detail.slice(0, 800) : JSON.stringify(detail ?? `${failedKey}: ${o[failedKey]}`).slice(0, 800);
}

// Short label of which external service an action targets — used by the
// /approvals page to pick a display icon/description for the review queue.
/**
 * What the approver reads on /approvals: the text the agent is about to write when its output reports
 * it (content / content_preview), otherwise the output itself. A 3000-character cut of the raw JSON hid
 * most of a long document — a FAQ's payment answers never reached the reviewer.
 */
/**
 * The shape (field names and types, no values) of each Composio response the script received, as
 * the sandbox SDK reports it on stderr (`__AF_SHAPE__:{json}`). Fixers guessed response fields: a
 * Gmail script read 'internalDate' where Composio sends 'messageTimestamp' and dated every email 1970.
 */
export function parseResponseShapes(stderr: string): string {
  const lines: string[] = [];
  for (const line of stderr.split('\n')) {
    const at = line.indexOf('__AF_SHAPE__:');
    if (at === -1) continue;
    try {
      const s = JSON.parse(line.slice(at + '__AF_SHAPE__:'.length));
      if (typeof s?.action === 'string' && typeof s?.shape === 'string') lines.push(`${s.action} → ${s.shape}`);
    } catch { /* truncated line */ }
  }
  return lines.slice(0, 12).join('\n').slice(0, 6000);
}

export interface DeferredWrite { action: string; params: unknown }

/** Writes the preview deferred, as reported by the sandbox SDK on stderr (`__AF_DEFERRED__:{json}`). */
export function parseDeferredWrites(stderr: string): DeferredWrite[] {
  const writes: DeferredWrite[] = [];
  for (const line of stderr.split('\n')) {
    const at = line.indexOf('__AF_DEFERRED__:');
    if (at === -1) continue;
    try {
      const w = JSON.parse(line.slice(at + '__AF_DEFERRED__:'.length));
      if (typeof w?.action === 'string') writes.push({ action: w.action, params: w.params });
    } catch { /* truncated line */ }
  }
  return writes.slice(0, 20);
}

/**
 * "Will run:" lines naming each deferred call and its short parameters (who, where, access), so the
 * reviewer sees what the call itself does — not only what the agent's output says. Long text
 * (bodies, document content) is left to the preview below.
 */
export function describeDeferredWrites(writes: DeferredWrite[]): string {
  if (writes.length === 0) return '';
  const fmt = (v: unknown) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v) ?? '';
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  };
  const lines = writes.slice(0, 8).map(w => {
    const params = w.params && typeof w.params === 'object' && !Array.isArray(w.params)
      ? Object.entries(w.params as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== '' && !(typeof v === 'string' && v.length > 160))
        .map(([k, v]) => `${k}: ${fmt(v)}`).join(', ')
      : '';
    return `• ${w.action}${params ? ` — ${params}` : ''}`;
  });
  if (writes.length > 8) lines.push(`• …and ${writes.length - 8} more`);
  return `Will run:\n${lines.join('\n')}`;
}

/** The longest text a deferred call will write (email body, message, document) — exactly what gets sent. */
function deferredText(writes: DeferredWrite[]): string | undefined {
  let best: string | undefined;
  for (const w of writes) {
    if (!w.params || typeof w.params !== 'object' || Array.isArray(w.params)) continue;
    for (const [k, v] of Object.entries(w.params as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 160 && /body|text|markdown|content|message|html|description/i.test(k) && v.length > (best?.length ?? 0)) best = v;
    }
  }
  return best;
}

/** Deferred calls for storage on the approval row: long text is already in the preview. */
export function compactWrites(writes: DeferredWrite[]): DeferredWrite[] {
  return writes.map(w => ({
    action: w.action,
    params: w.params && typeof w.params === 'object' && !Array.isArray(w.params)
      ? Object.fromEntries(Object.entries(w.params as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v]))
      : w.params,
  }));
}

export function approvalPreview(output: unknown, writes: DeferredWrite[] = []): string {
  const calls = describeDeferredWrites(writes);
  // The text the call itself carries beats the agent's own summary of it, which is often cut short.
  const body = deferredText(writes) ?? previewText(output);
  return calls ? `${calls}\n\n${body}`.slice(0, 12_000) : body;
}

function previewText(output: unknown): string {
  let parsed: any = output;
  if (typeof output === 'string') {
    try { parsed = JSON.parse(output); } catch { return output.slice(0, 12_000); }
  }
  const pick = (...keys: string[]): string | undefined => {
    if (!parsed || typeof parsed !== 'object') return undefined;
    const v = keys.map(k => parsed[k]).find(x => typeof x === 'string' && x.trim());
    return v as string | undefined;
  };
  // For a message, who it goes to and its subject matter most — an email send showed only the
  // document text passed along from the previous agent, not the recipient.
  const header = [
    pick('recipient', 'recipient_email', 'to', 'to_email', 'email_to', 'recipients') && `To: ${pick('recipient', 'recipient_email', 'to', 'to_email', 'email_to', 'recipients')}`,
    pick('channel', 'channel_name', 'slack_channel') && `Channel: ${pick('channel', 'channel_name', 'slack_channel')}`,
    pick('subject', 'email_subject') && `Subject: ${pick('subject', 'email_subject')}`,
  ].filter(Boolean).join('\n');
  // Known names first, then the longest text field whose name says it holds the written content
  // (agents name it freely: notes_content, report_markdown, summary_text, ...).
  const contentLike = (): string | undefined => {
    if (!parsed || typeof parsed !== 'object') return undefined;
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([k, v]) => typeof v === 'string' && v.length > 200 && /content|text|body|markdown|notes|summary|report|message|draft/i.test(k))
      .sort((a, b) => (b[1] as string).length - (a[1] as string).length)[0]?.[1] as string | undefined;
  };
  const text = pick('body', 'email_body', 'body_preview', 'message', 'message_text', 'message_preview', 'slack_message', 'post_text', 'text', 'content', 'content_preview') ?? contentLike();
  if (header) return `${header}\n\n${text ?? ''}`.trim().slice(0, 12_000);
  if (text) return text.slice(0, 12_000);
  return (typeof output === 'string' ? output : JSON.stringify(output, null, 2)).slice(0, 6_000);
}

const COMPOSIO_TARGETS: Record<string, string> = {
  GMAIL: 'gmail', GOOGLESHEETS: 'sheets', GOOGLEDOCS: 'docs', GOOGLECALENDAR: 'calendar', GOOGLEDRIVE: 'drive',
  SLACK: 'slack', GITHUB: 'github', NOTION: 'notion', LINKEDIN: 'linkedin', TWITTER: 'twitter',
  FACEBOOK: 'facebook', INSTAGRAM: 'instagram', DISCORD: 'discord', WHATSAPP: 'whatsapp', HUBSPOT: 'hubspot',
};

export function inferActionTarget(code: string, agentRole: string): string {
  // Prefer the write actions the script actually calls (riskiest first). Matching service names
  // anywhere in the code labelled a Google Doc write "slack" because a prompt string mentioned Slack.
  const writeSlugs = [...code.matchAll(/composio_execute\(\s*["']([A-Z][A-Z0-9_]+)["']/g)]
    .map(m => m[1])
    .filter(slug => classifyAgentActions(`composio_execute("${slug}", {})`).hasWriteOps)
    .sort((a, b) => Number(classifyAgentActions(`composio_execute("${b}", {})`).writeRisk === 'write_irreversible')
      - Number(classifyAgentActions(`composio_execute("${a}", {})`).writeRisk === 'write_irreversible'));
  if (writeSlugs.length > 0) {
    const toolkit = writeSlugs[0].split('_')[0];
    return COMPOSIO_TARGETS[toolkit] ?? toolkit.toLowerCase();
  }

  const c = code.toLowerCase();
  if (c.includes('gmail')) return 'gmail';
  if (c.includes('sheet')) return 'sheets';
  if (c.includes('calendar')) return 'calendar';
  if (c.includes('drive.upload') || c.includes("'drive'")) return 'drive';
  if (c.includes('linkedin')) return 'linkedin';
  if (c.includes('twitter') || c.includes('post_tweet')) return 'twitter';
  if (c.includes('slack')) return 'slack';
  if (c.includes('github')) return 'github';
  if (c.includes('notion')) return 'notion';
  if (c.includes('facebook')) return 'facebook';
  if (c.includes('instagram')) return 'instagram';
  if (c.includes('discord')) return 'discord';
  if (c.includes('whatsapp')) return 'whatsapp';
  return agentRole.toLowerCase();
}

// Maps Python import names → the pip package(s) they require.
// Used to install only what the script actually needs instead of the full set every time.
function getRequiredPackages(code: string): string[] {
  const PIP_MAP: Record<string, string[]> = {
    'requests':             ['requests'],
    'bs4':                  ['beautifulsoup4'],
    'beautifulsoup4':       ['beautifulsoup4'],
    'googleapiclient':      ['google-api-python-client'],
    'google_auth_oauthlib': ['google-auth-oauthlib'],
    'google':               ['google-api-python-client', 'google-auth-oauthlib'],
    'openai':               ['openai'],
    'google.generativeai':  ['google-generativeai'],
    'generativeai':         ['google-generativeai'],
    'anthropic':            ['anthropic'],
    'matplotlib':           ['matplotlib'],
    'pandas':               ['pandas'],
    'numpy':                ['numpy'],
    'openpyxl':             ['openpyxl'],
    'docx':                 ['python-docx'],
    'pptx':                 ['python-pptx'],
    'PyPDF2':               ['PyPDF2'],
    'pypdf2':               ['PyPDF2'],
    'feedparser':           ['feedparser'],
    'lxml':                 ['lxml'],
    'PIL':                  ['Pillow'],
    'yaml':                 ['pyyaml'],
    'dotenv':               ['python-dotenv'],
    'tweepy':               ['tweepy'],
    'slack_sdk':            ['slack-sdk'],
  };

  const needed = new Set<string>();
  // requests is always required — the agenticfactor SDK core uses it
  needed.add('requests');

  for (const match of code.matchAll(/^(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm)) {
    const pkgs = PIP_MAP[match[1]];
    if (pkgs) pkgs.forEach(p => needed.add(p));
  }

  return [...needed];
}

export interface AgentResult {
  output: string;
  finalCode: string;
  signal?: {
    type: 'user_prompt' | 'schedule' | 'notify' | 'missing_permission';
    question?: string;
    options?: string[];
    delay?: number;
    provider?: string;
    message?: string;
  };
}

export async function executeAgent(
  tenantId: string,
  missionId: string,
  agent: AgentConfig,
  inputContext: string,
  tokens: { provider: string, access_token: string }[] = [],
  isFinalAgent: boolean = false,
  expectedOutputFormat?: string,
  runId?: string,
  extraEnvs?: Record<string, string>
): Promise<AgentResult> {
  const supabase = createServiceClient();

  // Log start
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'agent.started',
    entity_type: 'agent',
    entity_id: agent.id,
    run_id: runId ?? null,
    payload: { missionId, role: agent.role, inputContext },
  });

  // Resolve the mission title and training-mode status once up front — title
  // gives the /approvals queue real context, training status decides whether
  // every write action must be reviewed regardless of trust level (and never
  // actually executed) for this run.
  let missionTitle = 'Mission';
  // What the customer asked for, in the mission's own words — the critic checks outputs against it.
  let missionDescription = '';
  let isTrainingMode = false;
  let trainingRunNumber = 0;
  let tenantPlan = 'free';
  // Composio actions the mission plan declares (permission scopes) — what the customer approved.
  const declaredActions = new Set<string>();
  // The script attempt 1 runs: the blueprint's locked script, or a draft left by a failed execution
  // of that exact script, so a step retry or the next run continues the fixer's progress instead of
  // repeating the same failures. Editing the blueprint changes the locked script and retires the draft.
  let lockedScript = agent.pythonScript ?? '';
  let startingScript = lockedScript;
  try {
    const [{ data: missionRow }, { data: billingRow }] = await Promise.all([
      supabase.from('missions').select('mission_json, training_enabled, training_runs_completed').eq('id', missionId).single(),
      supabase.from('tenant_billing').select('plan').eq('tenant_id', tenantId).single(),
    ]);
    for (const perm of (missionRow?.mission_json?.permissions ?? []) as Array<{ scope?: string }>) {
      for (const slug of String(perm.scope ?? '').split(',')) {
        if (/^[A-Z][A-Z0-9_]{3,}$/.test(slug.trim())) declaredActions.add(slug.trim());
      }
    }
    if (missionRow?.mission_json?.title) missionTitle = missionRow.mission_json.title;
    // The customer's verbatim words when the mission kept them (quotes, figures, names); else the summary.
    const sourceRequest = missionRow?.mission_json?.sourceRequest;
    if (typeof sourceRequest === 'string' && sourceRequest.trim()) missionDescription = sourceRequest;
    else if (typeof missionRow?.mission_json?.description === 'string') missionDescription = missionRow.mission_json.description;
    isTrainingMode = missionRow?.training_enabled === true;
    trainingRunNumber = (missionRow?.training_runs_completed ?? 0) + 1;
    tenantPlan = billingRow?.plan ?? 'free';
    const dbAgent = ((missionRow?.mission_json?.agents ?? []) as any[]).find(a => a.id === agent.id);
    if (typeof dbAgent?.pythonScript === 'string' && dbAgent.pythonScript.trim()) lockedScript = dbAgent.pythonScript;
    startingScript = lockedScript;
    const draft = dbAgent?.pythonScriptDraft as { code?: string; basedOn?: string } | undefined;
    if (draft?.code && draft.basedOn === scriptHash(lockedScript)) {
      console.log(`[Agent ${agent.id}] Starting from the draft left by the last failed execution.`);
      startingScript = draft.code;
    }
  } catch { /* non-fatal — falls back to 'Mission', training mode off, free plan */ }

  // Latest script that passed the syntax and Composio checks — saved as the draft on failure.
  let lastCheckedCode = '';
  const saveDraft = async () => {
    if (!lastCheckedCode || lastCheckedCode === startingScript) return;
    try {
      const { data } = await supabase.from('missions').select('mission_json').eq('id', missionId).single();
      const node = (data?.mission_json?.agents ?? []).find((a: any) => a.id === agent.id);
      if (!node) return;
      node.pythonScriptDraft = { code: lastCheckedCode, basedOn: scriptHash(node.pythonScript ?? '') };
      await supabase.from('missions').update({ mission_json: data!.mission_json }).eq('id', missionId);
    } catch (e) {
      console.warn(`[Agent ${agent.id}] Could not save script draft:`, (e as Error).message);
    }
  };

  // Run-scoped pass for ask_ai() in the sandbox SDK (/api/sandbox/llm) — usable for nothing else.
  let sandboxLLMEnv: Record<string, string> = {};
  try {
    const { mintSandboxLLMToken } = await import('../sandbox-llm-token');
    sandboxLLMEnv = {
      AF_LLM_TOKEN: await mintSandboxLLMToken({ tenantId, missionId, agentRole: agent.role, runId }),
      AF_API_BASE: process.env.NEXT_PUBLIC_APP_URL || 'https://agenticfactor.io',
    };
  } catch (tokenErr) {
    console.warn(`[Agent ${agent.id}] ask_ai unavailable for this run:`, (tokenErr as Error).message);
  }

  // Everything a script needs to reach the tenant's services. One builder for both the normal attempt
  // and the approved-resume path: the resume copy had drifted and lacked COMPOSIO_ENTITY_ID, so every
  // human-approved Composio write (emails, Slack posts) failed with "COMPOSIO_ENTITY_ID is not set".
  const buildSandboxEnvs = (): Record<string, string> => {
    const envs: Record<string, string> = {};
    // Base64 keeps INPUT_CONTEXT safe from E2B's env injection (quotes, backslashes, etc.)
    if (inputContext) envs['INPUT_CONTEXT_B64'] = Buffer.from(inputContext, 'utf-8').toString('base64');
    for (const token of tokens) {
      const providerKey = token.provider.toUpperCase();
      envs[`${providerKey}_ACCESS_TOKEN`] = token.access_token;
      // Locally stored API keys (not Composio-managed placeholders) also go in as _API_KEY,
      // so Python modules like creative.py find them under either name.
      if (token.access_token !== 'composio_managed') envs[`${providerKey}_API_KEY`] = token.access_token;
    }
    if (process.env.TAVILY_API_KEY) envs['TAVILY_API_KEY'] = process.env.TAVILY_API_KEY;
    if (process.env.SERPAPI_KEY) envs['SERPAPI_KEY'] = process.env.SERPAPI_KEY;
    if (process.env.SENDGRID_API_KEY) envs['SENDGRID_API_KEY'] = process.env.SENDGRID_API_KEY;
    if (process.env.TWITTER_BEARER_TOKEN) envs['TWITTER_BEARER_TOKEN'] = process.env.TWITTER_BEARER_TOKEN;
    if (process.env.FACEBOOK_APP_ID) envs['FACEBOOK_APP_ID'] = process.env.FACEBOOK_APP_ID;
    // Composio — entity_id is the tenantId, enables composio_execute() in the Python SDK
    if (process.env.COMPOSIO_API_KEY) envs['COMPOSIO_API_KEY'] = process.env.COMPOSIO_API_KEY;
    envs['COMPOSIO_ENTITY_ID'] = tenantId;
    // Dates in scripts follow the customer's day, not UTC: a standup bot run at 04:00 IST
    // reported "yesterday" as two days ago. (The wrapper calls time.tzset() so it takes effect.)
    envs['TZ'] = process.env.DEFAULT_TENANT_TIMEZONE || 'Asia/Kolkata';
    // Custom connector metadata (base_url, auth_type, auth_header) from the executor
    if (extraEnvs) Object.assign(envs, extraEnvs);
    Object.assign(envs, sandboxLLMEnv);
    return envs;
  };

  // Build environment variables from tokens
  const envVars = tokens.reduce((acc, t) => {
    acc[`${t.provider.toUpperCase()}_ACCESS_TOKEN`] = t.access_token;
    return acc;
  }, {} as Record<string, string>);
  
  const envString = Object.entries(envVars).map(([k, v]) => `-e ${k}="${v}"`).join(' ');

  let attempts = 0;
  const maxAttempts = 5;
  let lastError = '';
  // What the script's Composio calls actually returned on the last attempt — shown to the fixers.
  let lastResponseShapes = '';
  let lastPythonCode = '';
  // Whether this agent's first script was read-only; a retry may not turn it into a writer.
  let firstScriptReadOnly: boolean | null = null;

  // Check if we are resuming an approved manual action
  const { data: existingAction } = await supabase
    .from('proposed_actions')
    .select('id, status, payload, action_type')
    .eq('tenant_id', tenantId)
    .eq('mission_id', missionId)
    .eq('agent_id', agent.id)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single();

  if (existingAction) {
    if (existingAction.status === 'pending') {
      console.log(`[Agent ${agent.id}] Agent is currently paused pending approval.`);
      throw new Error('PausedForApproval');
    }
    if (existingAction.status === 'rejected' && runId && existingAction.payload?.runId === runId) {
      // Rejected during this very run — typically while its step was still retrying, before the run
      // showed as paused. Retrying fresh here turned the rejection into a new pending approval of
      // the same content (interview emails with wrong weekdays came back for approval a second time).
      throw new Error('Stopped: the reviewer rejected the proposed action.');
    }
    if (existingAction.status === 'rejected') {
      // A rejection used to hard-fail this agent permanently — even after the
      // human fixed the underlying issue (e.g. via a Chief of Staff
      // correction), clicking Resume would just hit this same stale row and
      // fail again forever, with Fresh Start (which restarts EVERY agent)
      // as the only way out. Instead: clear the stale rejection and retry
      // this agent fresh, using whatever the blueprint says now. This does
      // not bypass any safety check — if the action is still a write action
      // requiring approval, the normal approval gate fires again below and
      // the human reviews it again before anything happens.
      console.log(`[Agent ${agent.id}] Previous attempt was rejected — clearing it and retrying with the current blueprint.`);
      await supabase.from('proposed_actions').delete().eq('id', existingAction.id);
    } else if (existingAction.status === 'approved' && existingAction.payload && existingAction.payload.output !== undefined) {
      const approvedCode = existingAction.payload.pythonCode || agent.pythonScript || '';
      // Steps that finished after an approval left no agent.completed event, so a resume could not
      // reuse them and ran them (and their writes) again. Training previews are not recorded: their
      // placeholder output must never feed a live run.
      const recordApprovedCompletion = async (output: string) => {
        await supabase.from('events').insert({
          tenant_id: tenantId, event_type: 'agent.completed', entity_type: 'agent', entity_id: agent.id,
          run_id: runId ?? null, payload: { missionId, output, approvedAction: existingAction.id },
        });
      };
      const { hasWriteOps: approvedHasWriteOps } = classifyAgentActions(approvedCode);

      if (existingAction.action_type === 'training_review') {
        // Training approval means "this preview looks correct" — it is NOT
        // permission to actually fire the action. Continue the rehearsal
        // with the dry-run output exactly as it was reviewed.
        console.log(`[Agent ${agent.id}] Training review approved — continuing with preview output, no real action taken.`);
        return { output: existingAction.payload.output, finalCode: approvedCode };
      }

      if (approvedHasWriteOps) {
        // The stored payload is the Phase 1 PREVIEW the human approved — the
        // real side effect has not happened yet. Run it for real now, for
        // the first time, instead of returning a result that was never seen
        // before approval.
        console.log(`[Agent ${agent.id}] Approved — executing the real action for the first time now.`);
        const resumeEnvs = buildSandboxEnvs();

        // Claim the approval atomically: an approval that lands while the run is still retrying its
        // step can reach two invocations, and only one of them may perform the real action.
        const { data: claimed } = await supabase
          .from('proposed_actions')
          .update({ payload: { ...existingAction.payload, executedAt: new Date().toISOString() } })
          .eq('id', existingAction.id)
          .eq('status', 'approved')
          .is('payload->>executedAt', null)
          .select('id');
        if (!claimed?.length) {
          const { data: current } = await supabase.from('proposed_actions').select('payload').eq('id', existingAction.id).single();
          if (current?.payload?.realOutput !== undefined) {
            console.log(`[Agent ${agent.id}] Approved action already executed — reusing its result.`);
            return { output: current.payload.realOutput, finalCode: approvedCode };
          }
          throw new Error(`The approved action for "${agent.role}" is already being executed by another run — not running it twice.`);
        }

        const realOutput = await runRealSideEffects(approvedCode, resumeEnvs, existingAction.payload.output, agent.id, tenantId);
        await supabase.from('proposed_actions')
          .update({ payload: { ...existingAction.payload, executedAt: new Date().toISOString(), realOutput } })
          .eq('id', existingAction.id);
        await recordApprovedCompletion(realOutput);
        return { output: realOutput, finalCode: approvedCode };
      }

      console.log(`[Agent ${agent.id}] Resuming execution with approved payload.`);
      await recordApprovedCompletion(existingAction.payload.output);
      return { output: existingAction.payload.output, finalCode: approvedCode };
    } else if (existingAction.status === 'approved') {
      // Approved, but payload/output is missing — a malformed or
      // manually-edited row. This used to silently fall through into the
      // attempt loop below as if no existingAction existed at all, treating
      // a real data-integrity problem as a no-op. Log it loudly and clear
      // the row so it doesn't keep silently mismatching on every future
      // call — the agent still gets a fresh attempt below, but the gap
      // itself is now visible instead of hidden.
      console.error(`[Agent ${agent.id}] Approved action row ${existingAction.id} is missing usable payload.output — data integrity issue. Clearing it and starting a fresh attempt.`);
      await supabase.from('proposed_actions').delete().eq('id', existingAction.id);
    }
  }

  // The whole attempt loop runs inside one Inngest step (one ~300s serverless invocation). When it
  // overran, the step was killed mid-attempt, retried from attempt 1, killed again, and the run went
  // silent until the watchdog. Stop starting attempts once the budget is mostly used, and fail clearly.
  // Phase 1 attempts must leave room for the critic and a full-length Phase 2 (~30s setup + script),
  // so each attempt's script timeout shrinks to the time left before that deadline.
  const loopStartedAt = Date.now();
  const PHASE1_DEADLINE_MS = STEP_BUDGET_MS - SCRIPT_TIMEOUT_MS - 30_000;
  const SANDBOX_SETUP_MS = 15_000;
  const MIN_ATTEMPT_MS = 20_000;
  let attemptTimeoutMs = SCRIPT_TIMEOUT_MS;

  while (attempts < maxAttempts) {
    // Hard stop well inside the step even if fixes keep failing their static checks.
    if (attempts > 0 && Date.now() - loopStartedAt > PHASE1_DEADLINE_MS) {
      await saveDraft();
      throw new Error(`Agent "${agent.role}" ran out of time after ${attempts} attempt(s). ${lastError}`);
    }
    attempts++;
    
    // ── Billing Enforcement: Deduct E2B execution credit per attempt ──
    // LLM model credit cost is deducted separately after we know which model was used.
    try {
      const { deductCredits, CREDIT_COSTS } = await import('@/lib/middleware/billing');
      const e2bCost = (isTrainingMode && tenantPlan === 'free') ? Math.ceil(CREDIT_COSTS.code_execution / 2) : CREDIT_COSTS.code_execution;
      await deductCredits(tenantId, e2bCost, `e2b_execution_attempt_${attempts}:${agent.role}`);
    } catch (err) {
      console.warn(`[Agent ${agent.id}] Insufficient credits for execution, stopping.`, err);
      throw new Error('InsufficientCredits');
    }

    let pythonCode = null;
    
    if (existingAction && existingAction.status === 'approved' && existingAction.payload && existingAction.payload.pythonCode) {
      console.log(`[Agent ${agent.id}] Resuming execution with approved Python code.`);
      pythonCode = existingAction.payload.pythonCode;
    } else if (
      startingScript.trim() !== '' &&
      // A script that ran past its own time limit is deterministic (too much work), not transient.
      (attempts === 1 || (attempts === 2 && isTransientError(lastError) && !/^Timeout \(\d+s\) in agent/.test(lastError)))
    ) {
      // Attempt 1: always use the locked script from the blueprint.
      // Attempt 2: if the failure was transient (timeout, network, rate limit) retry the same
      // locked script instead of asking the LLM to regenerate from scratch.
      console.log(
        `[Agent ${agent.id}] Using locked script from blueprint (attempt ${attempts}` +
        `${attempts > 1 ? ' — transient error on attempt 1, retrying locked script' : ''}).`
      );
      pythonCode = startingScript;
    } else {
      // ── COMPOSIO-AWARE RETRY: if the failing script used composio_execute(),
      // regenerate with a targeted Composio correction prompt + live action schema
      // rather than the generic AF SDK prompt. This prevents retries from
      // silently switching from composio_execute() calls to AF SDK calls, which
      // breaks Composio-managed providers entirely (no token exists for them).
      if (lastError && lastPythonCode.includes('composio_execute(')) {
        try {
          const actionRegex = /composio_execute\s*\(\s*["']([A-Z][A-Z0-9_]{3,})["']/g;
          const usedSlugs = new Set<string>();
          let am;
          while ((am = actionRegex.exec(lastPythonCode)) !== null) {
            usedSlugs.add(am[1]);
          }

          let composioHint = '';
          if (usedSlugs.size > 0) {
            const { buildComposioFixContext } = await import('../composio-actions');
            composioHint = await buildComposioFixContext([...usedSlugs]).catch(() => '');
          }

          // The fixer must know the agent's job and the runtime rules, not just the error: without them it
          // kept "fixing" critic rejections ("output shows only metadata") by changing anything but the output.
          const composioFixPrompt = `You are an expert Python developer fixing a script that uses composio_execute().

THE AGENT'S JOB (what the fixed script must accomplish):
${(agent.systemPrompt || agent.role).slice(0, 4000)}

RUNTIME RULES:
- The whole script must finish within ${SCRIPT_TIMEOUT_MS / 1000}s. Generate text with \`ask_ai(prompt, system="", max_tokens=1500)\` from agenticfactor._core — about 60 tokens/second, so keep each call to ~1500 tokens. For a long document or several pieces use \`ask_ai_batch([p1, p2, ...], system="", max_tokens=1500)\` with one prompt per section; it runs them in parallel. Never call ask_ai in a loop and never ask for one huge output. If the script timed out or ask_ai reports its output was cut off, split the work into sections with ask_ai_batch.
- If the agent writes a document, email, message or post, the printed JSON MUST include the text it wrote (\`"content": text\`, or \`"content_preview": text[:10000]\`) next to the IDs/URLs. Output with only metadata fails review.
- If the error is a failed review, change what the script produces so the reviewer's reason no longer applies.
- \`input_data["_pipeline"]\` holds every earlier agent's output keyed by role; if the review says data for some parts is missing, read those parts from there.
- If the script found nothing, its output must say what it checked (repos/channels/inboxes, date range, items scanned) next to the zero.
- This script may already have run partway (a retry after a partial failure): before creating a record, look it up by its natural key (name, number, title + date) and reuse it — never create a duplicate.
- If the toolkit has no action for what the script needs (e.g. Zoho Books reports), call the app's REST API through the customer's connection: \`composio_proxy("<toolkit_slug>", "GET", "/path", params={...}, body=None)\` from agenticfactor._core — never approximate the data from other actions.

THE INPUT THIS SCRIPT RECEIVES (input_data, shortened — read fields by these exact names):
${describeInputShape(inputContext || '')}

${lastResponseShapes ? `WHAT THE COMPOSIO CALLS RETURNED on the last attempt (field names and types — read values by exactly these names, never guess others):
${lastResponseShapes}

` : ''}FAILED SCRIPT:
\`\`\`python
${lastPythonCode}
\`\`\`

ERROR:
${lastError}

${composioHint || 'Use composio_execute("EXACT_ACTION_NAME", {params}) for all Composio-managed services.'}

Fix the script. Rules:
- Keep using composio_execute() — NEVER switch to direct HTTP calls or SDK wrappers
- If the action name was wrong, use the exact name from the list above
- If the parameters were wrong, use the exact parameter names from [req: ...] hints above
- If the script only reads data, it MUST stay read-only: NEVER use an action that creates, updates, sends or deletes anything to work around a missing read action. If no suitable read action exists, print a JSON object with "status": "error" explaining that.
- Return the COMPLETE corrected Python script in a \`\`\`python block`;

          const composioFixResponse = await callLLM(
            [{ role: 'system', content: composioFixPrompt }],
            { temperature: 0.0, jsonMode: false, tier: 2 }
          );

          const composioFixCode = extractPythonBlock(composioFixResponse.content);
          if (composioFixCode) {
            pythonCode = sanitizePythonCode(composioFixCode);
            console.log(`[Agent ${agent.id}] Composio-aware correction applied (attempt ${attempts})`);
            // Deduct LLM credit for this fix call (token-proportional)
            try {
              const { deductCredits, calculateLLMCreditCost } = await import('@/lib/middleware/billing');
              const fixCostBase = await calculateLLMCreditCost(composioFixResponse.model, composioFixResponse.inputTokens ?? 0, composioFixResponse.outputTokens ?? 0);
              const fixCost = (isTrainingMode && tenantPlan === 'free') ? Math.ceil(fixCostBase / 2) : fixCostBase;
              await deductCredits(tenantId, fixCost, `llm_composio_fix:${agent.role}`);
            } catch { /* non-fatal */ }
          }
        } catch (composioFixErr) {
          console.warn(`[Agent ${agent.id}] Composio-aware fix failed, falling back to full regeneration:`, composioFixErr);
        }
      }

      if (pythonCode) {
        // Composio fix succeeded — skip full AF SDK regeneration
      } else {
      // Ask the LLM to generate one dynamically
      const toolDescriptions = agent.tools.map(t => `- ${t.name}: ${t.type} tool`).join('\n');
      const envKeys = Object.keys(envVars).join(', ');

      let errorContext = '';
      if (lastError) {
        errorContext = `THE PREVIOUS SCRIPT FAILED WITH THIS ERROR:\n${lastError}\n\nBROKEN SCRIPT:\n\`\`\`python\n${lastPythonCode}\n\`\`\`\nPlease fix the bug and write the corrected code.`;
      }
      
      // Phase 6.3: RAG Injection — Query mission's knowledge base for relevant context
      const { generateEmbedding } = await import('../llm-router');
      const ragQueryText = `${agent.role}: ${agent.systemPrompt}. Input context: ${inputContext?.substring(0, 500) || 'initial'}`;
      const queryEmbedding = await generateEmbedding(ragQueryText);
      if (queryEmbedding) {
        const { deductCredits: deductEmbed, CREDIT_COSTS: EC } = await import('@/lib/middleware/billing');
        deductEmbed(tenantId, EC.embedding, `rag_embedding:${agent.role}`).catch(() => {});
      }

      let availableResources = '';
      let strictBoundaries = '';

      if (queryEmbedding) {
        const vectorString = `[${queryEmbedding.join(',')}]`;
        const { data: ragChunks } = await supabase.rpc('match_asset_chunks', {
          query_embedding: vectorString,
          match_threshold: 0.5,
          match_count: 5,
          p_tenant_id: tenantId,
          p_mission_id: missionId
        });

        if (ragChunks && ragChunks.length > 0) {
          ragChunks.forEach((chunk: any) => {
            if (chunk.classification === 'boundary') {
              strictBoundaries += `- ${chunk.content}\n`;
            } else {
              availableResources += `- ${chunk.content}\n`;
            }
          });
          console.log(`[Agent ${agent.id}] RAG injected: ${ragChunks.length} chunks (${ragChunks.filter((c: any) => c.classification === 'boundary').length} boundaries)`);
        }
      } else {
        console.log(`[Agent ${agent.id}] No embedding provider available — skipping RAG injection.`);
      }

      const systemPrompt = `
You are an expert Python developer writing an automation script.
Your task: ${agent.role}
System Instructions: ${agent.systemPrompt}
Available Tools/APIs: ${toolDescriptions || 'No tools available.'}

INPUT CONTEXT FROM PREVIOUS STEPS (input_data, shortened — read fields by these exact names):
${describeInputShape(inputContext || '', 6000)}

${lastResponseShapes ? `WHAT THE COMPOSIO CALLS RETURNED on the last attempt (field names and types — read values by exactly these names, never guess others):
${lastResponseShapes}

` : ''}

AVAILABLE RESOURCES (Extracted from RAG Database):
${availableResources || 'None.'}

STRICT BOUNDARIES (Do NOT violate these):
${strictBoundaries || 'None.'}

${errorContext}

${isFinalAgent && expectedOutputFormat ? `CRITICAL FINAL OUTPUT FORMAT REQUIREMENT:
You are the final agent in this mission. Your final JSON output MUST structurally match this expected format/schema:
${expectedOutputFormat}
Do NOT output literal data from the sample if it doesn't make sense, but you MUST follow its JSON schema, keys, and structure exactly.` : ''}

==== AGENTICFACTOR SDK (PRE-INSTALLED) ====
The \`agenticfactor\` Python SDK is pre-installed and provides tested, reliable wrappers for all connected APIs.
**USE THIS SDK instead of writing raw HTTP requests.** It handles authentication, retries, and error handling automatically.

AVAILABLE MODULES:
  from agenticfactor import gmail, calendar, drive, sheets, search, files, api, social
  from agenticfactor._core import ask_user, notify_user, schedule_check

  # GMAIL — Send, read, search emails
  gmail.send(to="user@email.com", subject="Subject", body="Body text", cc="cc@email.com", html=False)
  gmail.search(query="from:hr@company.com has:attachment", max_results=10)
  gmail.read(message_id="...")  # Returns {from, to, subject, body, attachments}
  gmail.draft(to="...", subject="...", body="...")
  gmail.download_attachment(message_id, attachment_id)  # Returns bytes

  # GOOGLE CALENDAR — Events and free slots
  calendar.list_events(start="2024-06-01", end="2024-06-30")
  calendar.create_event(summary="Meeting", start="2024-06-15T10:00:00", end="2024-06-15T11:00:00", attendees=["a@b.com"], send_notifications=True)
  calendar.update_event(event_id, summary="Updated Title")
  calendar.find_free_slots(duration_minutes=45, range_days=14, calendars=["primary"], count=5)

  # GOOGLE DRIVE — File management
  drive.list_files(query="report", file_type="pdf")
  drive.read_file(file_id)  # Returns text content
  drive.upload_file(name="report.txt", content="...", mime_type="text/plain")
  drive.share_file(file_id, email="user@email.com", role="reader")

  # GOOGLE SHEETS — Spreadsheet management
  sheets.create(title="Candidates", data=[["Name", "Score"], ["Alice", 95]], share_with=["hr@company.com"])
  sheets.read(spreadsheet_id, range_name="Sheet1!A1:Z100")
  sheets.update(spreadsheet_id, range_name="Sheet1!A1", data=[["Updated"]])
  sheets.append_rows(spreadsheet_id, data=[["New Row", 123]])

  # WEB SEARCH — Search the internet
  search.web_search(query="best recruitment platforms 2024", max_results=5)
  search.news_search(query="tech layoffs", max_results=5)

  # FILE PARSING — Read documents
  files.parse_pdf(file_path_or_bytes)  # Returns extracted text
  files.parse_docx(file_path_or_bytes)
  files.parse_csv(file_path_or_bytes)  # Returns 2D list
  files.parse_excel(file_path_or_bytes)

  # SOCIAL MEDIA — Twitter/X, LinkedIn, Facebook, Instagram (USE THIS for all social posting)
  social.post_tweet(text="Your tweet text here")  # Post to Twitter/X (max 280 chars per tweet)
  social.get_tweets(query="agenticfactor", max_results=10)  # Search recent tweets
  social.get_twitter_user_me()  # Get authenticated Twitter profile
  social.post_linkedin(text="Your LinkedIn post", visibility="PUBLIC")  # Post to LinkedIn
  social.get_linkedin_profile()  # Get LinkedIn profile (returns sub, name, email)
  social.get_facebook_pages()  # List managed Facebook Pages → returns [{id, name, access_token}]
  social.post_facebook(page_id="PAGE_ID", message="Post text")  # Post to Facebook Page
  social.get_instagram_accounts()  # List linked Instagram business accounts
  social.post_instagram(ig_user_id="IG_USER_ID", image_url="https://...", caption="Caption")
  social.post_to_all(text="Cross-post text", platforms=["twitter", "linkedin"])  # Post to multiple

  # UNIVERSAL API — Call ANY connector with OAuth token
  api.call(provider="salesforce", method="GET", endpoint="/services/data/v58.0/query", params={"q": "SELECT Id FROM Lead"})
  api.call(provider="hubspot", method="GET", endpoint="/crm/v3/objects/contacts")
  api.slack_send(channel="#general", text="Hello team!")
  api.github_create_issue(owner="org", repo="repo", title="Bug", body="Details")

  # NOTION — Always search for the page/database ID first, never hardcode it
  # Step 1: Search to find the target page or database
  notion_results = api.call("notion", "POST", "/search", json_data={"query": "page title or keyword"}, headers={"Notion-Version": "2022-06-28"})
  notion_page_id = notion_results["results"][0]["id"]  # Use the first match
  # Step 2: Create a page under it
  api.call("notion", "POST", "/pages", json_data={"parent": {"page_id": notion_page_id}, "properties": {"title": [{"text": {"content": "Page Title"}}]}, "children": [{"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"text": {"content": "Content here"}}]}}]}, headers={"Notion-Version": "2022-06-28"})

  # INTERACTIVE — Pause and ask user, or schedule future checks
  ask_user(question="What budget should I use?", options=["$500", "$1000", "$2000"])
  notify_user(message="Job posting has been published to LinkedIn", email=True)
  schedule_check(delay="3d", context={"posted_to": "linkedin"}, reason="Check application count")

INSTRUCTIONS:
1. Write a complete, self-contained Python script to accomplish this task.
2. The script MUST print the final output as a valid JSON string to standard output (stdout).
3. Do NOT print anything else to stdout. Use sys.stderr.write() for any debugging or logs.
4. **USE THE agenticfactor SDK** for all API interactions. It handles OAuth tokens automatically.
5. For social media (Twitter/X, LinkedIn, Facebook, Instagram) ALWAYS use the \`social\` module — e.g. \`social.post_tweet()\`, \`social.post_linkedin()\`. NEVER write raw HTTP requests for social APIs.
6. For Twitter threads: post each tweet individually using \`social.post_tweet(text=tweet)\` in a loop — Twitter has no native thread API.
7. If the SDK doesn't have a specific wrapper, use \`api.call(provider, method, endpoint)\` for any connector.
8. OAuth tokens are also available as environment variables if needed: ${envKeys || 'None'}
9. **CRITICAL STRICT RULE**: NEVER output simulated, mocked, or placeholder data. You MUST execute real API requests using the SDK. (The platform itself may run your script once as a safety preview in which write calls — send, post, create — return {"status": "ok", "dry_run": True} instead of executing; read optional response fields with .get() and never treat a dry_run response as an error.)
10. Enclose your Python code inside a triple-backtick block with 'python' as the language identifier.
11. **DO NOT CATCH FATAL ERRORS**: Let the script crash naturally on errors.
12. **READING INPUT**: Previous agent data is in \`_input_data\` (parsed JSON dict) and \`_input\` (raw string).
13. If you need to ask the user something, use \`ask_user()\`. The script will pause and resume when user responds.
13b. **TEXT AT RUNTIME**: To summarise, write, translate, classify or analyse data the script fetched (emails, reports, briefs, posts, READMEs), call \`ask_ai(prompt, system="", max_tokens=1500, json_mode=False)\` from \`agenticfactor._core\` — it returns the AI's text. NEVER hard-code long documents into the script; keep scripts short and generate long text with ask_ai at runtime (about 60 tokens/second — keep each call to ~1500 tokens and split long documents into sections). Each call takes 10-25s and the whole script must finish in ${SCRIPT_TIMEOUT_MS / 1000}s: for several independent pieces (one per template, section or item) use \`ask_ai_batch(prompts, system="", max_tokens=1500)\` from \`agenticfactor._core\`, which runs them in parallel and returns the texts in order — never call ask_ai in a loop.
13c. **OUTPUT WHAT YOU WRITE**: if the agent writes a document, email, message or post, include the text it wrote in the printed JSON next to the IDs/URLs (\`"content": text\`, or \`"content_preview": text[:10000]\` for very long documents). The reviewer and the approval screen judge that text — output with only metadata (id, url, title, status) fails review.
14. **MULTI-LINE STRINGS**: For multi-line text, use triple double-quotes (""" only, NEVER triple single-quotes '''). NEVER put raw HTML inside triple-quoted strings — it breaks Python syntax. Instead, build HTML using a list of strings joined together: lines = []; lines.append('<tr>'); html = '\n'.join(lines).
15. **JSON IN STRINGS**: When building JSON manually, use json.dumps() instead of hand-crafting JSON strings with f-strings.
16. **HTML CONTENT**: NEVER embed raw HTML directly in triple-quoted strings. ALWAYS build HTML by concatenating regular strings or using a list: parts = []; parts.append(f'<tr><td>{name}</td></tr>'); html = ''.join(parts). This prevents quote conflicts.
17. **STRING SAFETY**: Never mix quote types carelessly. If a string contains single quotes, wrap it in double quotes. If it contains double quotes, wrap it in single quotes. For strings with both, use triple double-quotes (""" only).`;


      const response = await callLLM(
        [{ role: 'system', content: systemPrompt }], 
        { temperature: 0.1, jsonMode: false, tier: 2 }
      );

      // ── Deduct LLM credit: token-proportional at 4× real cost via live USD/INR ──
      // Always deduct — even if later E2B execution fails, we already paid the provider.
      try {
        const { deductCredits, calculateLLMCreditCost } = await import('@/lib/middleware/billing');
        const llmCostBase = await calculateLLMCreditCost(response.model, response.inputTokens ?? 0, response.outputTokens ?? 0);
        const llmCost = (isTrainingMode && tenantPlan === 'free') ? Math.ceil(llmCostBase / 2) : llmCostBase;
        await deductCredits(tenantId, llmCost, `llm_${response.provider}:${response.model}:${agent.role}`, {
          provider: response.provider,
          model: response.model,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
        });
        console.log(`[Agent ${agent.id}] LLM credit: ${llmCost} (model: ${response.model}, in:${response.inputTokens} out:${response.outputTokens})`);
      } catch (creditErr) {
        console.warn(`[Agent ${agent.id}] LLM credit deduction failed:`, creditErr);
      }
      
      // More flexible regex: handles ```python, ``` python, and variations
      const extracted = extractPythonBlock(response.content);
      if (!extracted) {
        lastError = "Failed to extract Python code from LLM response. Make sure to use triple-backtick python blocks.";
        console.warn(`[Agent ${agent.id} attempt ${attempts}] LLM returned no python block.`);
        continue;
      }
      
      pythonCode = extracted;
      } // end inner else (full AF SDK regeneration)
    } // end outer else (composio-aware + full regeneration)

    // Sanitize LLM-generated code: fix unterminated strings, etc.
    pythonCode = sanitizePythonCode(pythonCode);

    // ── SYNTAX PRE-CHECK: Validate Python syntax BEFORE wasting an E2B sandbox run ──
    // Catches all syntax errors (predefined scripts, LLM-generated, and healed code)
    // If broken, asks the LLM to fix with targeted error info, then re-validates.
    const validateAndFixSyntax = async (code: string, maxPasses: number = 2): Promise<string> => {
      for (let pass = 0; pass < maxPasses; pass++) {
        const syntaxCheckCode = `import ast\ntry:\n    ast.parse(${JSON.stringify(code)})\n    print("SYNTAX_OK")\nexcept SyntaxError as e:\n    print(f"SYNTAX_ERROR:{e.lineno}:{e.msg}:{e.text}")`;
        
        try {
          const checkSandbox = await createSandboxWithRetry(15_000);
          const checkResult = await checkSandbox.runCode(syntaxCheckCode);
          await checkSandbox.kill().catch(() => {});
          
          const checkOutput = (checkResult.text || '').trim();
          
          if (!checkOutput.startsWith('SYNTAX_ERROR:')) {
            if (pass > 0) console.log(`[Agent ${agent.id}] Syntax fixed on pass ${pass + 1}.`);
            return code; // Code is valid
          }
          
          const parts = checkOutput.replace('SYNTAX_ERROR:', '').split(':');
          const errorLine = parts[0] || '?';
          const errorMsg = parts[1] || 'unknown syntax error';
          const errorText = parts.slice(2).join(':') || '';
          
          console.warn(`[Agent ${agent.id}] Syntax pre-check pass ${pass + 1} FAILED at line ${errorLine}: ${errorMsg} → ${errorText}`);
          
          // Ask the LLM to fix with VERY specific instructions for known error patterns
          const fixResponse = await callLLM([
            { role: 'system', content: `You are an expert Python syntax fixer. Fix the EXACT syntax error and return the COMPLETE corrected code inside a \`\`\`python block.

SYNTAX ERROR FOUND:
- Line ${errorLine}: ${errorMsg}
- Offending text: ${errorText}

CRITICAL FIX RULES (follow these EXACTLY):

1. UNTERMINATED STRING LITERAL (e.g. \`if text.startswith("\`):
   - The string was opened with " but never closed on the same line
   - FIX: Close the string properly. Example: \`if text.startswith("{")\`
   - NEVER split a regular string across multiple lines

2. INVALID DECIMAL LITERAL (e.g. \`"""$45M"\`):
   - Dollar sign $ after triple quotes causes Python to misparse
   - FIX: Use regular single-quoted strings for dollar amounts: '$45M'
   - NEVER use triple quotes (""" or ''') for short strings with dollar signs
   - Example: amount = '$45M' NOT amount = """$45M"""

3. F-STRING SINGLE '}' NOT ALLOWED:
   - Happens when } appears inside an f-string without being doubled
   - FIX: Use regular string formatting instead of complex f-strings
   - BAD:  f"{chr(10).join([f\\"\\"\\"{i+1}. {name}\\" for ...])}"
   - GOOD: numbered_list = "\\n".join([f"{i+1}. {name}" for i, name in enumerate(names)])

4. GENERAL RULES:
   - Use regular quotes ('...' or "...") for ALL short strings
   - Triple quotes ONLY for actual multi-line text blocks, NEVER for one-liners
   - Use json.dumps() to build JSON, never hand-craft with f-strings
   - Build HTML with list.append() + ''.join(), never in triple quotes
   - NEVER nest f-strings inside f-strings
   - For complex string building, use .format() or % formatting instead of f-strings` },
            { role: 'user', content: `Fix this Python code:\n\n\`\`\`python\n${code}\n\`\`\`` }
          ], { temperature: 0.0, jsonMode: false, tier: 2 });
          
          const fixCode = extractPythonBlock(fixResponse.content);
          if (fixCode) {
            code = sanitizePythonCode(fixCode);
            console.log(`[Agent ${agent.id}] Code regenerated after syntax fix (pass ${pass + 1}).`);
          } else {
            console.warn(`[Agent ${agent.id}] LLM fix had no python block on pass ${pass + 1}.`);
            break; // Can't fix without a code block
          }
        } catch (syntaxCheckErr) {
          console.warn(`[Agent ${agent.id}] Syntax check pass ${pass + 1} failed (non-fatal):`, syntaxCheckErr);
          break;
        }
      }
      return code;
    };

    pythonCode = await validateAndFixSyntax(pythonCode);

    lastPythonCode = pythonCode;

    // A fixer that can't find a valid read action has substituted a write (e.g. a "fetch open deals"
    // agent switched to HUBSPOT_CREATE_CRM_OBJECT_FROM_NL); once a mission graduates, a reversible
    // write like that can run without review, so a read-only agent must never drift into writing.
    // Writes the customer's plan declares (e.g. after "also save it to a Doc") stay allowed.
    const scriptWrites = classifyAgentActions(pythonCode).hasWriteOps;
    const undeclaredWrites = [...new Set([...pythonCode.matchAll(/composio_execute\s*\(\s*["']([A-Z][A-Z0-9_]+)["']/g)].map(m => m[1]))]
      .filter(slug => classifyAgentActions(`composio_execute("${slug}", {})`).hasWriteOps && !declaredActions.has(slug));
    const dynamicComposioCalls =
      (pythonCode.match(/composio_execute\s*\(/g) ?? []).length >
      (pythonCode.match(/composio_execute\s*\(\s*["'][A-Z][A-Z0-9_]+["']/g) ?? []).length;
    const nonComposioWrites = dynamicComposioCalls ||
      classifyAgentActions(pythonCode.replace(/composio_execute\s*\([^)]*\)/g, '')).hasWriteOps;
    if (firstScriptReadOnly === null) {
      firstScriptReadOnly = !scriptWrites;
    } else if (firstScriptReadOnly && scriptWrites && (undeclaredWrites.length > 0 || nonComposioWrites)) {
      lastError = `Rejected fix: this agent only reads data, but the corrected script writes${undeclaredWrites.length ? ` via ${undeclaredWrites.join(', ')}` : ''}, which the mission plan does not include. Use read actions only (GET/LIST/SEARCH/FETCH/...); if none fits, print {"status": "error", ...} explaining what is missing.`;
      console.warn(`[Agent ${agent.id}] ${lastError}`);
      supabase.from('events').insert({
        tenant_id: tenantId, event_type: 'agent.attempt_failed', entity_type: 'agent', entity_id: agent.id,
        run_id: runId ?? null, payload: { missionId, role: agent.role, attempt: attempts, maxAttempts, error: lastError },
      }).then(() => {}, () => {});
      continue;
    }

    // Composio silently ignores unknown parameters, so a misspelled one "succeeds" while doing
    // nothing (e.g. an empty Google Doc reported as published). Reject such code before running it;
    // the Composio-aware fixer gets the valid parameter names on the next attempt.
    if (pythonCode.includes('composio_execute(')) {
      try {
        const { findComposioCalls, checkComposioParams, autoFixComposioParams } = await import('../composio-param-check');
        const prefixes = [...new Set(findComposioCalls(pythonCode).map(c => c.action.split('_')[0].toLowerCase()))];
        const { getComposioActionSchemas } = await import('../composio-actions');
        const schemas = await getComposioActionSchemas(prefixes);
        const autoFixed = autoFixComposioParams(pythonCode, schemas);
        if (autoFixed.renames.length > 0) {
          console.log(`[Agent ${agent.id}] Corrected Composio parameter names: ${autoFixed.renames.join('; ')}`);
          pythonCode = autoFixed.code;
        }
        const problems = checkComposioParams(pythonCode, schemas);
        if (problems.length > 0) {
          lastError = `Composio parameter check failed before running — fix these calls:\n${problems.join('\n')}`;
          console.warn(`[Agent ${agent.id}] ${lastError}`);
          supabase.from('events').insert({
            tenant_id: tenantId, event_type: 'agent.attempt_failed', entity_type: 'agent', entity_id: agent.id,
            run_id: runId ?? null, payload: { missionId, role: agent.role, attempt: attempts, maxAttempts, error: lastError.slice(0, 1000) },
          }).then(() => {}, () => {});
          continue;
        }
      } catch (paramCheckErr) {
        console.warn(`[Agent ${agent.id}] Composio parameter check skipped:`, (paramCheckErr as Error).message);
      }
    }

    lastCheckedCode = pythonCode;

    // Time check after the fix is generated and checked, so that when there is no time left to run it,
    // the fixer's newest script is saved as the draft the next execution starts from — instead of the
    // next run repeating the script that already failed.
    const timeLeft = PHASE1_DEADLINE_MS - (Date.now() - loopStartedAt) - SANDBOX_SETUP_MS;
    attemptTimeoutMs = Math.min(SCRIPT_TIMEOUT_MS, Math.max(timeLeft, MIN_ATTEMPT_MS));
    if (attempts > 1 && timeLeft < MIN_ATTEMPT_MS) {
      await saveDraft();
      throw new Error(
        `Agent "${agent.role}" ran out of time after ${attempts - 1} attempt(s); its latest fix is saved and will run first next time. ${lastError}`
      );
    }

    // ── SMART EXECUTION MODE: detect write ops before any sandbox is allocated ──
    // Write agents:    Phase 1 (dry run, AF_DRY_RUN=1) validates safety → Phase 2 executes real side effects.
    // Read-only agents: bypass dry run entirely — one sandbox, direct execution. ~50% fewer sandbox launches.
    // hasWriteOps drives the dry-run/real-run split below; writeRisk is the
    // finer-grained signal (reversible vs irreversible) used by the approval gate.
    const { hasWriteOps, writeRisk } = classifyAgentActions(pythonCode);

    try {
      console.log(`[Agent ${agent.id}] Sandbox attempt ${attempts} — ${hasWriteOps ? 'write-ops: dry-run → real-run (2 sandboxes)' : 'read-only: direct single-run (1 sandbox)'}...`);

      // Build environment variables for the sandbox
      const sandboxEnvs = buildSandboxEnvs();

      // Only apply dry-run guard for write-op agents — read-only agents run directly
      if (hasWriteOps) {
        sandboxEnvs['AF_DRY_RUN'] = '1';
      }

      // Prepend import of input context from env — available as `_input` (raw string) and `_input_data` (parsed JSON)
      // INPUT_CONTEXT is also set in os.environ so scripts that use os.environ.get('INPUT_CONTEXT', '{}')
      // instead of _input_data still receive the correct data (LLM code generation inconsistency guard).
      const wrappedCode = `import os, sys, json, base64
try:
    _b64 = os.environ.get('INPUT_CONTEXT_B64', '')
    _input = base64.b64decode(_b64).decode('utf-8') if _b64 else '{}'
    os.environ['INPUT_CONTEXT'] = _input
    try:
        _input_data = json.loads(_input, strict=False)
    except:
        # Fallback: try cleaning the input
        cleaned = ''.join(c if ord(c) > 31 or c in '\\n\\r\\t' else ' ' for c in _input)
        try:
            _input_data = json.loads(cleaned)
        except:
            _input_data = {}
except:
    _input = '{}'
    _input_data = {}
    os.environ['INPUT_CONTEXT'] = '{}'

import time as _af_time
try:
    _af_time.tzset()
except Exception:
    pass
import matplotlib
matplotlib.use('Agg')

${pythonCode}`;

      // Execute in E2B cloud sandbox (pre-warmed, <1s start time)
      const sandbox = await createSandboxWithRetry(SANDBOX_LIFETIME_MS);

      try {
        // Install only the packages this script actually imports — skip unused heavy deps.
        // --prefer-binary: download pre-built wheels, avoids source compilation.
        // --no-cache-dir: skip cache I/O (ephemeral sandbox, no persistent cache anyway).
        // --disable-pip-version-check: removes one extra network round-trip.
        const phase1Pkgs = getRequiredPackages(pythonCode);
        const phase1PipCmd = `import subprocess, sys; subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "--prefer-binary", "--no-cache-dir", "--disable-pip-version-check"] + ${JSON.stringify(phase1Pkgs)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)`;
        await sandbox.runCode(phase1PipCmd, { envs: sandboxEnvs });

        // Install agenticfactor SDK by writing files into the sandbox
        const { getSDKFiles } = await import('@/lib/sandbox/sdk-loader');
        const sdkFiles = getSDKFiles();
        for (const [filename, content] of Object.entries(sdkFiles)) {
          try {
            await sandbox.files.write(`/home/user/agenticfactor/${filename}`, content);
          } catch (e) {
            console.warn(`[Agent ${agent.id}] SDK file ${filename} write failed, skipping`);
          }
        }
        // Add SDK to Python path
        await sandbox.runCode('import sys; sys.path.insert(0, "/home/user")', { envs: sandboxEnvs });

        // Final safety: strip any null bytes from the complete code (Python hard-rejects \x00)
        const safeCode = wrappedCode.replace(/\x00/g, '');
        
        // Execute the agent's Python script
        const execution = await sandbox.runCode(safeCode, { envs: sandboxEnvs, timeoutMs: attemptTimeoutMs });

        const stdout = execution.logs.stdout.join('\n').trim();
        const stderr = execution.logs.stderr.join('\n').trim();
        const deferredWrites = parseDeferredWrites(stderr);
        lastResponseShapes = parseResponseShapes(stderr) || lastResponseShapes;

        if (execution.error) {
          throw new Error(`E2B execution error: ${execution.error.name}: ${execution.error.value}\n${execution.error.traceback}`);
        }

        if (stderr && !stdout) {
          console.warn(`[Agent ${agent.id} stderr]:`, stderr);
        }

        // ── Signal Detection: Check for interactive signals from agenticfactor SDK ──
        const signalMatch = stdout.match(/__SIGNAL__:(.+)$/m);
        let detectedSignal: AgentResult['signal'] | undefined;
        
        if (signalMatch) {
          try {
            const signal = JSON.parse(signalMatch[1]);
            
            // Helper: get tenant email from Supabase Auth
            const getTenantEmail = async (): Promise<string | null> => {
              try {
                const { data: { user } } = await supabase.auth.admin.getUserById(tenantId);
                return user?.email || null;
              } catch { return null; }
            };
            
            if (signal.__user_prompt__) {
              // Save prompt to DB and pause execution
              await supabase.from('events').insert({
                tenant_id: tenantId,
                event_type: 'agent.user_prompt',
                entity_type: 'agent',
                entity_id: agent.id,
                payload: { missionId, question: signal.__user_prompt__.question, options: signal.__user_prompt__.options },
              });
              console.log(`[Agent ${agent.id}] User prompt requested: ${signal.__user_prompt__.question}`);
              
              // Set signal for executor to detect
              detectedSignal = {
                type: 'user_prompt',
                question: signal.__user_prompt__.question,
                options: signal.__user_prompt__.options,
              };
              
              // Send notification email
              try {
                const { sendEmail } = await import('../notifications');
                const tenantEmail = await getTenantEmail();
                if (tenantEmail) {
                  await sendEmail({
                    to: tenantEmail,
                    subject: `🤖 Mission needs your input — ${agent.role}`,
                    body: `Your mission agent needs your input.\n\nAgent: ${agent.role}\nQuestion: ${signal.__user_prompt__.question}${signal.__user_prompt__.options?.length ? '\n\nOptions:\n' + signal.__user_prompt__.options.map((o: string, i: number) => `  ${i + 1}. ${o}`).join('\n') : ''}\n\nPlease reply in the Mission Chat on your dashboard:\nhttps://agenticfactor.io/dashboard/missions/${missionId}`,
                  });
                }
              } catch (emailErr) { console.warn('Notification email failed:', emailErr); }
            }
            
            if (signal.__notify__) {
              try {
                const { sendEmail } = await import('../notifications');
                const tenantEmail = await getTenantEmail();
                if (tenantEmail) {
                  await sendEmail({
                    to: tenantEmail,
                    subject: `📋 Mission Update — ${agent.role}`,
                    body: `Mission Update\n\n${signal.__notify__.message}`,
                  });
                }
              } catch (emailErr) { console.warn('Notification email failed:', emailErr); }
            }
            
            if (signal.__missing_permission__) {
              detectedSignal = {
                type: 'missing_permission',
                provider: signal.__missing_permission__.provider,
              };
              
              try {
                const { sendEmail } = await import('../notifications');
                const adminEmail = process.env.ADMIN_EMAIL;
                const tenantEmail = await getTenantEmail();
                if (adminEmail) {
                  await sendEmail({
                    to: adminEmail,
                    subject: `⚠️ Missing Permission — ${signal.__missing_permission__.provider}`,
                    body: `A mission requires a connector that isn't configured.\n\nProvider: ${signal.__missing_permission__.provider}\nTenant: ${tenantEmail || tenantId}\nAgent: ${agent.role}\n\nPlease add this connector or contact the customer.`,
                  });
                }
                if (tenantEmail) {
                  await sendEmail({
                    to: tenantEmail,
                    subject: `🔗 Connector Required — ${signal.__missing_permission__.provider}`,
                    body: `Your mission needs the ${signal.__missing_permission__.provider} connector to proceed.\n\nPlease go to the Connectors page on your dashboard and connect it.`,
                  });
                }
              } catch (emailErr) { console.warn('Admin notification failed:', emailErr); }
            }

            // ── Social Media API Call Tracking (per-call credit deduction) ──
            if (signal.__social_api_call__) {
              const { provider, action, cost_credits } = signal.__social_api_call__;
              console.log(`[Agent ${agent.id}] Social API call: ${provider}/${action} (${cost_credits} credits)`);
              try {
                await supabase.from('events').insert({
                  tenant_id: tenantId,
                  event_type: 'billing.social_api_call',
                  entity_type: 'agent',
                  entity_id: agent.id,
                  payload: { missionId, provider, action, cost_credits, agentRole: agent.role, timestamp: new Date().toISOString() },
                });
              } catch (billingErr) {
                console.warn(`[Agent ${agent.id}] Billing event insert failed (non-fatal):`, billingErr);
              }
            }

            // ── schedule_check() SDK call — pause mission and register a wake-up event ──
            if (signal.__schedule__) {
              const { delay, context: schedCtx, reason } = signal.__schedule__;
              console.log(`[Agent ${agent.id}] Schedule signal: delay=${delay} reason="${reason}"`);
              try {
                // Insert mission.wait event — the cron scheduler (api/cron/scheduler) reads these
                // and wakes the mission when the delay has elapsed.
                await supabase.from('events').insert({
                  tenant_id: tenantId,
                  event_type: 'mission.wait',
                  entity_type: 'mission',
                  entity_id: missionId,
                  payload: {
                    action: 'sleep',
                    duration: delay,
                    context: schedCtx ?? {},
                    agentId: agent.id,
                    agentRole: agent.role,
                    reason: reason ?? '',
                    scheduledAt: new Date().toISOString(),
                  },
                });
                // Transition mission to paused so executor stops here
                const { transitionMissionStatus } = await import('../orchestrator');
                await transitionMissionStatus(missionId, tenantId, 'paused');
              } catch (schedErr) {
                console.warn(`[Agent ${agent.id}] schedule_check persistence failed:`, schedErr);
              }
              detectedSignal = { type: 'schedule', delay };
            }
          } catch (sigErr) {
            console.warn(`[Agent ${agent.id}] Signal parse error:`, sigErr);
          }
        }

        // Check if stdout is valid JSON (filter out signal lines)
        let cleanStdout = stdout.split('\n').filter(line => !line.startsWith('__SIGNAL__:')).join('\n').trim();
        let finalOutputJSON = '';
        try {
          // Use robust parser: extracts JSON even from mixed text with debug prints
          const parsed = robustJSONParse(cleanStdout);
          finalOutputJSON = JSON.stringify(parsed);
        } catch (e) {
          // If signal was the only output, use the signal as output
          if (signalMatch) {
            finalOutputJSON = JSON.stringify({ status: 'signal_sent', signal: signalMatch[1] });
          } else if (cleanStdout) {
            // Last resort: wrap raw text as JSON so the pipeline doesn't break
            finalOutputJSON = JSON.stringify({ status: 'completed', raw_output: cleanStdout });
            console.warn(`[Agent ${agent.id}] Output was not JSON, wrapped as raw_output`);
          } else {
            throw new Error(`Script succeeded but produced no output.`);
          }
        }

        // --- FILE OUTPUT EXTRACTION: Collect artifacts from E2B sandbox ---
        const artifactUrls: { filename: string; url: string; contentType: string }[] = [];
        try {
          const artifactSupabase = createServiceClient();
          const storageBucket = 'mission-artifacts';
          const basePath = `${tenantId}/${missionId}/${agent.id}`;

          // 1. Check execution.results for inline artifacts (e.g. matplotlib .png)
          if (execution.results && execution.results.length > 0) {
            for (let ri = 0; ri < execution.results.length; ri++) {
              const result = execution.results[ri];
              if (result.png) {
                const filename = `chart_${ri}.png`;
                const buffer = Buffer.from(result.png, 'base64');
                const uploadPath = `${basePath}/${filename}`;
                const { error: upErr } = await artifactSupabase.storage
                  .from(storageBucket)
                  .upload(uploadPath, buffer, { contentType: 'image/png', upsert: true });
                if (!upErr) {
                  const { data: { publicUrl } } = artifactSupabase.storage
                    .from(storageBucket)
                    .getPublicUrl(uploadPath);
                  artifactUrls.push({ filename, url: publicUrl, contentType: 'image/png' });
                  console.log(`[Agent ${agent.id}] Uploaded inline artifact: ${filename}`);
                } else {
                  console.warn(`[Agent ${agent.id}] Failed to upload inline artifact ${filename}:`, upErr.message);
                }
              }
            }
          }

          // 2. Scan /tmp in sandbox for generated output files
          const scanExec = await sandbox.runCode(
            'import os, json; files = [f for f in os.listdir("/tmp") if f.endswith((".png", ".jpg", ".jpeg", ".pdf", ".csv", ".xlsx", ".html", ".svg", ".json", ".docx", ".pptx", ".txt", ".md", ".zip", ".xml", ".yaml", ".yml"))]; print(json.dumps(files))',
            { envs: sandboxEnvs }
          );
          const scanStdout = scanExec.logs.stdout.join('').trim();
          if (scanStdout) {
            const tmpFiles: string[] = JSON.parse(scanStdout);
            const contentTypeMap: Record<string, string> = {
              '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
              '.pdf': 'application/pdf', '.csv': 'text/csv',
              '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json',
              '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              '.txt': 'text/plain', '.md': 'text/markdown', '.zip': 'application/zip',
              '.xml': 'application/xml', '.yaml': 'text/yaml', '.yml': 'text/yaml',
            };
            for (const fname of tmpFiles) {
              try {
                const fileContent = await sandbox.files.read(`/tmp/${fname}`);
                const ext = '.' + fname.split('.').pop()!.toLowerCase();
                const ct = contentTypeMap[ext] || 'application/octet-stream';
                const uploadPath = `${basePath}/${fname}`;
                // fileContent can be string or Uint8Array; ensure Buffer
                const buf = typeof fileContent === 'string'
                  ? Buffer.from(fileContent, 'base64')
                  : Buffer.from(fileContent);
                const { error: upErr } = await artifactSupabase.storage
                  .from(storageBucket)
                  .upload(uploadPath, buf, { contentType: ct, upsert: true });
                if (!upErr) {
                  const { data: { publicUrl } } = artifactSupabase.storage
                    .from(storageBucket)
                    .getPublicUrl(uploadPath);
                  artifactUrls.push({ filename: fname, url: publicUrl, contentType: ct });
                  console.log(`[Agent ${agent.id}] Uploaded sandbox file: ${fname}`);
                } else {
                  console.warn(`[Agent ${agent.id}] Failed to upload ${fname}:`, upErr.message);
                }
              } catch (fileErr: any) {
                console.warn(`[Agent ${agent.id}] Failed to read/upload sandbox file ${fname}:`, fileErr.message);
              }
            }
          }

          // 3. Append artifact URLs to the output JSON
          if (artifactUrls.length > 0) {
            const parsed = JSON.parse(finalOutputJSON);
            parsed._artifacts = artifactUrls;
            finalOutputJSON = JSON.stringify(parsed);
            console.log(`[Agent ${agent.id}] Appended ${artifactUrls.length} artifact(s) to output.`);
          }
        } catch (artifactErr: any) {
          // Non-fatal: log and continue with original output
          console.warn(`[Agent ${agent.id}] Artifact extraction failed (non-fatal):`, artifactErr.message);
        }

        // --- PHASE 3: CRITIC PASS (every agent, not just the final one) ---
        // This used to only run for the final agent and only check structural
        // shape against expectedOutputFormat — every other agent's output was
        // trusted with zero verification, so a wrong-but-plausible result
        // (not fabricated, just incorrect) sailed straight through to the
        // next agent. This runs for every agent and checks whether the
        // output actually accomplishes that agent's own stated task, not
        // just whether the JSON is shaped right. Still deliberately lenient
        // on format — this is a correctness check, not a style check.
        {
          console.log(`[Agent ${agent.id}] Running critic pass on output...`);
          const criticPrompt = `You are a strict but fair Critic reviewing an AI agent's work — not just whether its output is shaped correctly, but whether it actually accomplishes the task.
Today is ${new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Dates up to today are past or present — never fail an output for using "future" dates that are not after today.
${hasWriteOps ? `
⚠️ THIS IS A PREVIEW RUN. The platform deliberately did NOT execute this agent's write actions (send, post, create doc/sheet/page/record); they run only after a human approves this preview. So "dry_run", "dry-run-preview" IDs/URLs, "not sent", "not created", or a status like "error"/"failed" that only reflects the missing write result are EXPECTED and must NEVER be a reason to fail. Judge only the content the agent prepared for those actions.
` : ''}
${missionDescription ? `WHAT THE CUSTOMER ASKED FOR (the whole mission — for reference only):
${missionDescription.slice(0, 6000)}
This agent is ONE step of that mission. Judge it only on its own task below; other steps handle the rest. Use the mission text only to check that specifics the customer gave (names, amounts, numbers, dates, recipients) are not replaced by different data.

` : ''}AGENT'S ROLE AND TASK:
${agent.systemPrompt || agent.role}

INPUT THE AGENT RECEIVED (the previous agent's output, or the run's trigger data — in a pipeline it can be work on another part of the job, e.g. research on a different brand; the agent only has to use what concerns its own task):
${criticInputView(inputContext || '')}

OUTPUT THE AGENT PRODUCED:
${finalOutputJSON}
${isFinalAgent && expectedOutputFormat ? `

EXPECTED FINAL OUTPUT FORMAT:
${expectedOutputFormat}` : ''}
${hasWriteOps ? `
PREVIEW RUN: this output comes from a safety dry run. Write actions (sending email or messages, posting, creating pages, records or files) were deliberately simulated and will only execute after human approval. Results marked dry_run or deferred, and empty IDs/URLs/"sent" flags for those writes, are EXPECTED — never fail the output for that. Judge whether the content prepared for those actions (recipients, subject, body, page or record content) is correct and complete for the task.
` : ''}
FAIL if:
- The output doesn't address what the agent was supposed to do at all
- The output contradicts or ignores the input it was given. Exception: in a pipeline an agent's input can be an earlier agent's work on a different part of the job (e.g. research on another brand) — adding its own part, and passing earlier data through, is correct
- The content is generic or placeholder-like instead of reflecting the specific task
- Specifics the customer gave (names, amounts, invoice or order numbers, dates, recipients) are replaced by different or sample data such as "Acme Corp" or "John Doe" — this always fails, however polished the output
- Text presented as a direct quote (in quotation marks or a blockquote) from material the customer supplied above, but worded differently from it — a reworded or invented quote always fails
- Factual claims about the customer's product or company that the material above doesn't contain — rankings ("a leading brand"), certifications, test results or how something was tested, regulated claims ("broad-spectrum", "dermatologist-tested", "clinically proven") — when the customer supplied the facts to use. Promotional tone ("innovative", "exciting") is fine; new facts are not${isFinalAgent && expectedOutputFormat ? `
- Required core fields from the expected format are completely missing or have the wrong type` : ''}

PASS if:
- The output reasonably accomplishes the stated task, even if imperfect, sparse, or in an unexpected (but valid) format
- An empty result is valid if the task is a search/lookup/filter that legitimately found nothing — an empty list in the required structure is the correct output; never ask for example rows or a demonstration of the schema. If you conclude nothing was legitimately found, the verdict must be PASS. But a bare "no activity" / count 0 that does not say what was checked (which repos, channels, inboxes, date range, how many items scanned) FAILS — without that nobody can tell an empty week from a broken query
- When the task or the mission says what happens if nothing qualifies (a fallback list the customer supplied, default content, "if none…"), finding nothing — or fewer than hoped — is an expected outcome: PASS when the output says what was checked and how many items were reviewed. Never demand a per-item explanation of why each item didn't qualify
- When the output lists the items it examined, judge its counts and categories against those items. If the items support the result (every email listed is an automated notification, so zero client requests is right), PASS — never fail for not demonstrating its method, and never fail a zero that the data itself explains
- On a re-run, records the step found already existing and reused ("already_exists", "reused", "skipped — exists") count as done: judge whether everything the task needs exists, created now or earlier — never fail a step for not re-creating what is already there
- Extra fields, metadata, or differently-named-but-equivalent keys are always fine
- Status values like "no_email", "failed:...", "skipped" are valid outcomes, not failures
- Saying a specific figure is not publicly available is CORRECT when the research didn't find it — never fail an output for honesty about missing data; invented numbers are the real failure
- The same holds for details public sources don't reveal (e.g. job postings that don't name the team): marking them "unknown" / "not specified" and working with what is available is correct. Fail only if the agent ignored data it had or made details up
- For web research, judge the findings and how honestly they are reported, not the search process: a source that returned only listing or category pages, a different number of searches than planned, or fewer results than hoped are not failures${hasWriteOps ? `
- (Preview run) the prepared content for the write action is right, even though the write itself shows as dry_run / placeholder / not executed` : ''}

Be a real critic, not a rubber stamp — but don't be pedantic about minor formatting choices.

Respond: {"valid": boolean, "reason": "string if invalid"}`;
          const criticResult = await callLLM([{ role: 'user', content: criticPrompt }], { temperature: 0, jsonMode: true, tier: 3 });
          const { deductCredits: deductCritic, calculateLLMCreditCost: calcCriticCost } = await import('@/lib/middleware/billing');
          const criticCostBase = await calcCriticCost(criticResult.model, criticResult.inputTokens ?? 0, criticResult.outputTokens ?? 0);
          const criticCost = (isTrainingMode && tenantPlan === 'free') ? Math.ceil(criticCostBase / 2) : criticCostBase;
          deductCritic(tenantId, criticCost, `critic_llm:${agent.role}`).catch(() => {});
          // A malformed verdict (e.g. an unescaped quote in the reason) used to fail the agent's attempt
          // with "Failed to extract valid JSON". Read the verdict from the text; if there is none, pass.
          let criticParsed: { valid?: boolean; reason?: string };
          try {
            criticParsed = robustJSONParse(criticResult.content);
          } catch {
            const verdict = /"valid"\s*:\s*(true|false)/i.exec(criticResult.content)?.[1]?.toLowerCase();
            const reason = /"reason"\s*:\s*"([\s\S]*?)("\s*[,}]|$)/.exec(criticResult.content)?.[1];
            console.warn(`[Agent ${agent.id}] Critic reply was not valid JSON; verdict read from text: ${verdict ?? 'none (passing)'}`);
            criticParsed = { valid: verdict !== 'false', reason: reason ?? 'The reviewer rejected the output.' };
          }
          if (!criticParsed.valid) {
            // Capture this as a feedback example before retrying — an
            // AI-self-detected mistake is a lower-confidence signal than a
            // human correction, but it's still real data on what commonly
            // goes wrong for this kind of task. Non-fatal: a failure here
            // must never block the retry this throw is about to trigger.
            try {
              const embedding = await generateEmbedding(`${agent.role}: ${criticParsed.reason}`);
              if (embedding) {
                await supabase.from('tenant_feedback_examples').insert({
                  tenant_id: tenantId,
                  source_mission_id: missionId,
                  source: 'critic',
                  agent_role: agent.role,
                  problem_summary: criticParsed.reason,
                  embedding,
                });
              }
            } catch (feedbackErr) {
              console.warn(`[Agent ${agent.id}] Feedback example capture failed (non-fatal):`, feedbackErr);
            }
            throw new Error(`Output failed critic review. Reason: ${criticParsed.reason}`);
          }
          console.log(`[Agent ${agent.id}] Critic pass passed.`);
        }

        // ═══ MOCK OUTPUT DETECTION ═══
        // Check if the Phase 1 output contains known mock/fake patterns that
        // indicate the script fabricated results instead of making real API
        // calls. Runs on the dry-run/preview output, before any approval
        // gate or real execution — no point asking a human to review, or
        // actually sending, something that was never real to begin with.
        // This is a hard failure (not a warning) — it triggers the normal
        // retry path so the LLM regenerates code with this error as context.
        const outputStr = finalOutputJSON.toLowerCase();
        const mockPatterns = [
          'urn:li:activity:pending',
          'urn:li:share:pending',
          '"pending"',
          '"placeholder"',
          '"simulated"',
          '"mock"',
          '"attempted"',
          '"example.com"',
          '"fake_',
          '"test_id"',
          '"sample_id"',
          '"dummy"',
          'acme corp',
          'john doe',
          'jane doe',
          'lorem ipsum',
          'todo: implement',
          '"dryrun_',
          '"dry_run": true',
        ];
        const detectedMocks = mockPatterns.filter(p => outputStr.includes(p));
        if (detectedMocks.length > 0) {
          console.warn(`[Agent ${agent.id}] ⚠️ MOCK OUTPUT DETECTED: ${detectedMocks.join(', ')}`);
          throw new Error(
            `Output contains fabricated/placeholder data instead of real API results. ` +
            `Detected patterns: ${detectedMocks.join(', ')}. ` +
            `You MUST call the actual SDK function and use its real returned values — never invent IDs, statuses, or placeholder text.`
          );
        }

        // Short label of which external service this action targets, used
        // by the /approvals page to pick an icon/description for the queue.
        const actionTarget = inferActionTarget(pythonCode, agent.role);

        // ═══ APPROVAL GATE — fires BEFORE Phase 2, using the Phase 1 preview ═══
        // Read-only agents (hasWriteOps=false) never reach this gate at all —
        // there is no real-world action to approve, only output to read.
        // Training mode overrides trust level entirely: every write action is
        // reviewed regardless of manual/conditional/autonomous, since the
        // whole point is a safe rehearsal. Outside training, manual trust
        // always asks for write actions; conditional trust only asks when
        // the action is irreversible. If none of these apply, Phase 2 runs
        // immediately below with no pause.
        const needsApproval = hasWriteOps && (
          isTrainingMode ||
          agent.trustLevel === 'manual' ||
          (agent.trustLevel === 'conditional' && writeRisk === 'write_irreversible')
        );

        if (needsApproval) {
          console.log(`[Agent ${agent.id}] Pausing for approval BEFORE the real action runs (training: ${isTrainingMode}, trust: ${agent.trustLevel}, risk: ${writeRisk}).`);

          const actionType = isTrainingMode
            ? 'training_review'
            : agent.trustLevel === 'manual' ? 'handoff_approval' : 'conditional_risk_review';

          await supabase.from('proposed_actions').insert({
            tenant_id: tenantId,
            mission_id: missionId,
            agent_id: agent.id,
            agent_role: agent.role,
            mission_title: missionTitle,
            action_type: actionType,
            description: isTrainingMode
              ? `🎓 Training run ${trainingRunNumber} — review what agent "${agent.role}" would do.`
              : agent.trustLevel === 'manual'
                ? `Review the proposed action for agent ${agent.role} before it runs.`
                : `⚠️ Irreversible action detected in agent "${agent.role}". Please review before it runs.`,
            explanation: isTrainingMode
              ? `This mission is in Training Mode — nothing actually sends or fires yet. This is a preview only; approving it just confirms the result looks right and continues the rehearsal.`
              : agent.trustLevel === 'manual'
                ? `This agent's trust level is set to Manual, so every action it takes is reviewed before it runs — regardless of risk.`
                : `This action can't be meaningfully undone once it runs (e.g. sending, posting, or deleting something external) — irreversible actions always require your review, even on agents you otherwise trust.`,
            target: actionTarget,
            risk_level: writeRisk === 'write_irreversible' ? 'high' : writeRisk === 'write_reversible' ? 'medium' : 'low',
            reversible: writeRisk !== 'write_irreversible',
            // This payload is the Phase 1 PREVIEW — nothing real has happened yet.
            payload: { output: finalOutputJSON, pythonCode, writeRisk, runNumber: isTrainingMode ? trainingRunNumber : undefined, runId },
            // What the reviewer sees on /approvals: the write actions about to run and the prepared content.
            payload_redacted: {
              actions: [...new Set([
                ...[...pythonCode.matchAll(/composio_execute\s*\(\s*["']([A-Z0-9_]+)["']/g)].map(m => m[1])
                  .filter(slug => classifyAgentActions(`composio_execute("${slug}", {})`).hasWriteOps),
                ...proxyWriteLabels(pythonCode),
              ])],
              preview: approvalPreview(finalOutputJSON, deferredWrites),
              writes: compactWrites(deferredWrites),
            },
            status: 'pending'
          });

          throw new Error('PausedForApproval');
        }

        // No approval needed — proceed to Phase 2 if this agent has write ops
        // (read-only agents and reversible-write agents under conditional
        // trust, plus any agent under autonomous trust, land here directly).
        if (hasWriteOps) {
          finalOutputJSON = await runRealSideEffects(pythonCode, sandboxEnvs, finalOutputJSON, agent.id, tenantId);
        } else {
          console.log(`[Agent ${agent.id}] No write operations detected — skipping Phase 2.`);
        }

        await supabase.from('events').insert({
          tenant_id: tenantId,
          event_type: 'agent.completed',
          entity_type: 'agent',
          entity_id: agent.id,
          run_id: runId ?? null,
          payload: { missionId, output: finalOutputJSON },
        });

        return { output: finalOutputJSON, finalCode: pythonCode, signal: detectedSignal };

      } finally {
        // Always clean up the sandbox
        await sandbox.kill().catch(() => {});
      }

    } catch (error: any) {
      if (error.message === 'PausedForApproval') {
        throw error; // Let it bubble up to executor
      }
      lastError = translateAgentError(error.message, agent.role);
      console.error(`[Agent ${agent.id}] E2B execution failed on attempt ${attempts}: ${lastError}`);
      supabase.from('events').insert({
        tenant_id: tenantId,
        event_type: 'agent.attempt_failed',
        entity_type: 'agent',
        entity_id: agent.id,
        run_id: runId ?? null,
        payload: { missionId, role: agent.role, attempt: attempts, maxAttempts, error: lastError.slice(0, 1000) },
      }).then(() => {}, () => {});
    }
  }

  await saveDraft();
  throw new Error(`Agent "${agent.role}" failed after ${maxAttempts} attempts. ${lastError}`);
}
