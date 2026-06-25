import { callLLM } from '../llm-router';
import { executeTool } from '../tools';
import { createServiceClient } from '@/lib/supabase/server';
import { Sandbox } from '@e2b/code-interpreter';
import { robustJSONParse } from '@/lib/utils/json-parser';

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
function sanitizePythonCode(code: string): string {
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
  
  while (i < lines.length) {
    const line = lines[i];
    
    // Detect a line that opens a string but doesn't close it
    // Matches patterns like: some_func('text that continues
    // or: variable = "text that continues  
    const unterminatedMatch = line.match(/^(.*?)(['\"])([^'"]*?)$/);
    
    if (unterminatedMatch && !line.trimStart().startsWith('#')) {
      const [, prefix, quote, startContent] = unterminatedMatch;
      
      // Check if this looks like an actual unterminated string (not a comment, not triple-quoted)
      // Count unmatched quotes in the prefix to determine if we're inside a string
      const prefixQuotes = (prefix.match(new RegExp(`(?<!\\\\)${quote === "'" ? "'" : '"'}`, 'g')) || []).length;
      
      if (prefixQuotes % 2 === 0) {
        // Even number of quotes before = this opens a new string that isn't closed
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

function translateAgentError(error: string, agentRole: string): string {
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
  if (error.includes('403') || error.toLowerCase().includes('forbidden')) {
    return (
      `Permission denied (403) in agent "${agentRole}": The OAuth token lacks the required scope. ` +
      `Go to the Connectors page and reconnect the account with the correct permissions.`
    );
  }
  // 401
  if (error.includes('401') || error.toLowerCase().includes('unauthorized')) {
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
    (error.toLowerCase().includes('fetch') && error.toLowerCase().includes('failed'))
  ) {
    return (
      `Network error in agent "${agentRole}": Cannot reach the external API. ` +
      `Check that your credentials are valid and the service is online.`
    );
  }
  // E2B timeout
  if (error.toLowerCase().includes('timed out') || error.toLowerCase().includes('timeout')) {
    return (
      `Timeout (120s) in agent "${agentRole}": The script ran too long. ` +
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

export function classifyAgentActions(code: string): { hasWriteOps: boolean; writeRisk: ActionRisk } {
  const matchedRisks: ActionRisk[] = ACTION_PATTERNS
    .filter(({ pattern }) => code.includes(pattern))
    .map(({ risk }) => risk);
  matchedRisks.push(...classifyGenericCalls(code));

  const writeRisk: ActionRisk = matchedRisks.includes('write_irreversible')
    ? 'write_irreversible'
    : matchedRisks.includes('write_reversible')
      ? 'write_reversible'
      : 'read';

  return { hasWriteOps: writeRisk !== 'read', writeRisk };
}

// ── PHASE 2: REAL SIDE EFFECTS ──────────────────────────────────────────
// Executes the validated pythonCode for real (no AF_DRY_RUN), merging Phase 1
// artifacts into the result. Falls back to the dry-run output unchanged if
// the real run fails to create/execute — Phase 1 already validated the data,
// so a Phase 2 infra failure shouldn't fail the whole agent.
// Extracted into its own function so the resume-after-approval path can
// invoke real execution for the first time at resume — previously the
// stored payload was already the result of a real run that happened BEFORE
// the human ever saw it, which defeats the point of asking for approval.
async function runRealSideEffects(
  pythonCode: string,
  sandboxEnvs: Record<string, string>,
  dryRunOutputJSON: string,
  agentId: string
): Promise<string> {
  let finalOutputJSON = dryRunOutputJSON;
  console.log(`[Agent ${agentId}] Phase 2: Executing real side effects...`);
  try {
    const finalEnvs = { ...sandboxEnvs };
    delete finalEnvs['AF_DRY_RUN'];

    const finalSandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: 120_000,
    });

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

import matplotlib
matplotlib.use('Agg')

${pythonCode}`.replace(/\x00/g, '');

      const finalExec = await finalSandbox.runCode(finalWrapped, { envs: finalEnvs });
      const finalStdout = finalExec.logs.stdout.join('\n').trim();

      if (finalExec.error) {
        console.error(`[Agent ${agentId}] Phase 2 (side effects) failed: ${finalExec.error.value}`);
        // Don't fail the mission — data was already validated in Phase 1
      } else {
        console.log(`[Agent ${agentId}] Phase 2: Side effects executed successfully.`);
        const cleanFinalStdout = finalStdout.split('\n').filter(line => !line.startsWith('__SIGNAL__:')).join('\n').trim();
        if (cleanFinalStdout) {
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
    console.error(`[Agent ${agentId}] Phase 2 sandbox creation failed (non-fatal):`, phase2Err.message);
  }
  return finalOutputJSON;
}

// Short label of which external service an action targets — used by the
// /approvals page to pick a display icon/description for the review queue.
function inferActionTarget(code: string, agentRole: string): string {
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
  expectedOutputFormat?: string
): Promise<AgentResult> {
  const supabase = createServiceClient();

  // Log start
  await supabase.from('events').insert({
    tenant_id: tenantId,
    event_type: 'agent.started',
    entity_type: 'agent',
    entity_id: agent.id,
    payload: { missionId, role: agent.role, inputContext },
  });

  // Resolve the mission title and training-mode status once up front — title
  // gives the /approvals queue real context, training status decides whether
  // every write action must be reviewed regardless of trust level (and never
  // actually executed) for this run.
  let missionTitle = 'Mission';
  let isTrainingMode = false;
  let trainingRunNumber = 0;
  try {
    const { data: missionRow } = await supabase
      .from('missions')
      .select('mission_json, training_enabled, training_runs_completed')
      .eq('id', missionId)
      .single();
    if (missionRow?.mission_json?.title) missionTitle = missionRow.mission_json.title;
    isTrainingMode = missionRow?.training_enabled === true;
    trainingRunNumber = (missionRow?.training_runs_completed ?? 0) + 1;
  } catch { /* non-fatal — falls back to 'Mission', training mode off */ }

  // Build environment variables from tokens
  const envVars = tokens.reduce((acc, t) => {
    acc[`${t.provider.toUpperCase()}_ACCESS_TOKEN`] = t.access_token;
    return acc;
  }, {} as Record<string, string>);
  
  const envString = Object.entries(envVars).map(([k, v]) => `-e ${k}="${v}"`).join(' ');

  let attempts = 0;
  const maxAttempts = 5;
  let lastError = '';
  let lastPythonCode = '';

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
        const resumeEnvs: Record<string, string> = {};
        if (inputContext) {
          resumeEnvs['INPUT_CONTEXT_B64'] = Buffer.from(inputContext, 'utf-8').toString('base64');
        }
        for (const token of tokens) {
          resumeEnvs[`${token.provider.toUpperCase()}_ACCESS_TOKEN`] = token.access_token;
        }
        if (process.env.TAVILY_API_KEY) resumeEnvs['TAVILY_API_KEY'] = process.env.TAVILY_API_KEY;
        if (process.env.SERPAPI_KEY) resumeEnvs['SERPAPI_KEY'] = process.env.SERPAPI_KEY;
        if (process.env.SENDGRID_API_KEY) resumeEnvs['SENDGRID_API_KEY'] = process.env.SENDGRID_API_KEY;
        if (process.env.TWITTER_BEARER_TOKEN) resumeEnvs['TWITTER_BEARER_TOKEN'] = process.env.TWITTER_BEARER_TOKEN;
        if (process.env.FACEBOOK_APP_ID) resumeEnvs['FACEBOOK_APP_ID'] = process.env.FACEBOOK_APP_ID;

        const realOutput = await runRealSideEffects(approvedCode, resumeEnvs, existingAction.payload.output, agent.id);
        return { output: realOutput, finalCode: approvedCode };
      }

      console.log(`[Agent ${agent.id}] Resuming execution with approved payload.`);
      return { output: existingAction.payload.output, finalCode: approvedCode };
    }
  }

  while (attempts < maxAttempts) {
    attempts++;
    
    // ── Billing Enforcement: Deduct E2B execution credit per attempt ──
    // LLM model credit cost is deducted separately after we know which model was used.
    try {
      const { deductCredits, CREDIT_COSTS } = await import('@/lib/middleware/billing');
      await deductCredits(tenantId, CREDIT_COSTS.code_execution, `e2b_execution_attempt_${attempts}:${agent.role}`);
    } catch (err) {
      console.warn(`[Agent ${agent.id}] Insufficient credits for execution, stopping.`, err);
      throw new Error('InsufficientCredits');
    }

    let pythonCode = null;
    
    if (existingAction && existingAction.status === 'approved' && existingAction.payload && existingAction.payload.pythonCode) {
      console.log(`[Agent ${agent.id}] Resuming execution with approved Python code.`);
      pythonCode = existingAction.payload.pythonCode;
    } else if (
      agent.pythonScript &&
      agent.pythonScript.trim() !== '' &&
      (attempts === 1 || (attempts === 2 && isTransientError(lastError)))
    ) {
      // Attempt 1: always use the locked script from the blueprint.
      // Attempt 2: if the failure was transient (timeout, network, rate limit) retry the same
      // locked script instead of asking the LLM to regenerate from scratch.
      console.log(
        `[Agent ${agent.id}] Using locked script from blueprint (attempt ${attempts}` +
        `${attempts > 1 ? ' — transient error on attempt 1, retrying locked script' : ''}).`
      );
      pythonCode = agent.pythonScript;
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

INPUT CONTEXT FROM PREVIOUS STEPS:
${inputContext || '{}'}

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
  from agenticfactor import gmail, calendar, drive, sheets, search, files, api
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

  # UNIVERSAL API — Call ANY connector with OAuth token
  api.call(provider="salesforce", method="GET", endpoint="/services/data/v58.0/query", params={"q": "SELECT Id FROM Lead"})
  api.call(provider="hubspot", method="GET", endpoint="/crm/v3/objects/contacts")
  api.linkedin_post(content="Exciting news!")
  api.slack_send(channel="#general", text="Hello team!")
  api.github_create_issue(owner="org", repo="repo", title="Bug", body="Details")
  api.notion_create_page(parent_id="...", title="New Page", content="...")

  # INTERACTIVE — Pause and ask user, or schedule future checks
  ask_user(question="What budget should I use?", options=["$500", "$1000", "$2000"])
  notify_user(message="Job posting has been published to LinkedIn", email=True)
  schedule_check(delay="3d", context={"posted_to": "linkedin"}, reason="Check application count")

INSTRUCTIONS:
1. Write a complete, self-contained Python script to accomplish this task.
2. The script MUST print the final output as a valid JSON string to standard output (stdout).
3. Do NOT print anything else to stdout. Use sys.stderr.write() for any debugging or logs.
4. **USE THE agenticfactor SDK** for all API interactions. It handles OAuth tokens automatically.
5. If the SDK doesn't have a specific wrapper, use \`api.call(provider, method, endpoint)\` for any connector.
6. OAuth tokens are also available as environment variables if needed: ${envKeys || 'None'}
7. **CRITICAL STRICT RULE**: NEVER output simulated, mocked, or placeholder data. You MUST execute real API requests using the SDK.
8. Enclose your Python code inside a triple-backtick block with 'python' as the language identifier.
9. **DO NOT CATCH FATAL ERRORS**: Let the script crash naturally on errors.
10. **READING INPUT**: Previous agent data is in \`_input_data\` (parsed JSON dict) and \`_input\` (raw string).
11. If you need to ask the user something, use \`ask_user()\`. The script will pause and resume when user responds.
12. **MULTI-LINE STRINGS**: For multi-line text, use triple double-quotes (""" only, NEVER triple single-quotes '''). NEVER put raw HTML inside triple-quoted strings — it breaks Python syntax. Instead, build HTML using a list of strings joined together: lines = []; lines.append('<tr>'); html = '\n'.join(lines).
13. **JSON IN STRINGS**: When building JSON manually, use json.dumps() instead of hand-crafting JSON strings with f-strings.
14. **HTML CONTENT**: NEVER embed raw HTML directly in triple-quoted strings. ALWAYS build HTML by concatenating regular strings or using a list: parts = []; parts.append(f'<tr><td>{name}</td></tr>'); html = ''.join(parts). This prevents quote conflicts.
15. **STRING SAFETY**: Never mix quote types carelessly. If a string contains single quotes, wrap it in double quotes. If it contains double quotes, wrap it in single quotes. For strings with both, use triple double-quotes (""" only).`;


      const response = await callLLM(
        [{ role: 'system', content: systemPrompt }], 
        { temperature: 0.1, jsonMode: false, tier: 2 }
      );

      // ── Deduct LLM credit based on actual model used ──
      // Always deduct — even if later E2B execution fails, we still paid the LLM provider
      try {
        const { deductCredits, CREDIT_COSTS } = await import('@/lib/middleware/billing');
        const { getModelCreditCost } = await import('@/lib/services/llm-router');
        const llmCost = getModelCreditCost(response.model);
        await deductCredits(tenantId, llmCost, `llm_${response.provider}:${response.model}:${agent.role}`, {
          provider: response.provider,
          model: response.model,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
        });
        console.log(`[Agent ${agent.id}] LLM credit: ${llmCost} (model: ${response.model}, tokens: ${response.tokensUsed})`);
      } catch (creditErr) {
        console.warn(`[Agent ${agent.id}] LLM credit deduction failed:`, creditErr);
      }
      
      // More flexible regex: handles ```python, ``` python, and variations
      const codeMatch = response.content.match(/```\s*python\s*\n([\s\S]*?)```/) 
        || response.content.match(/```\n([\s\S]*?)```/)
        || response.content.match(/```([\s\S]*?)```/);
      if (!codeMatch) {
        lastError = "Failed to extract Python code from LLM response. Make sure to use triple-backtick python blocks.";
        console.warn(`[Agent ${agent.id} attempt ${attempts}] LLM returned no python block.`);
        continue;
      }
      
      pythonCode = codeMatch[1];
    }

    // Sanitize LLM-generated code: fix unterminated strings, etc.
    pythonCode = sanitizePythonCode(pythonCode);

    // ── SYNTAX PRE-CHECK: Validate Python syntax BEFORE wasting an E2B sandbox run ──
    // Catches all syntax errors (predefined scripts, LLM-generated, and healed code)
    // If broken, asks the LLM to fix with targeted error info, then re-validates.
    const validateAndFixSyntax = async (code: string, maxPasses: number = 2): Promise<string> => {
      for (let pass = 0; pass < maxPasses; pass++) {
        const syntaxCheckCode = `import ast\ntry:\n    ast.parse(${JSON.stringify(code)})\n    print("SYNTAX_OK")\nexcept SyntaxError as e:\n    print(f"SYNTAX_ERROR:{e.lineno}:{e.msg}:{e.text}")`;
        
        try {
          const checkSandbox = await Sandbox.create({
            apiKey: process.env.E2B_API_KEY,
            timeoutMs: 15_000,
          });
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
          
          const fixMatch = fixResponse.content.match(/```\s*python\s*\n([\s\S]*?)```/);
          if (fixMatch) {
            code = sanitizePythonCode(fixMatch[1]);
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

    // ── SMART EXECUTION MODE: detect write ops before any sandbox is allocated ──
    // Write agents:    Phase 1 (dry run, AF_DRY_RUN=1) validates safety → Phase 2 executes real side effects.
    // Read-only agents: bypass dry run entirely — one sandbox, direct execution. ~50% fewer sandbox launches.
    // hasWriteOps drives the dry-run/real-run split below; writeRisk is the
    // finer-grained signal (reversible vs irreversible) used by the approval gate.
    const { hasWriteOps, writeRisk } = classifyAgentActions(pythonCode);

    try {
      console.log(`[Agent ${agent.id}] Sandbox attempt ${attempts} — ${hasWriteOps ? 'write-ops: dry-run → real-run (2 sandboxes)' : 'read-only: direct single-run (1 sandbox)'}...`);

      // Build environment variables for the sandbox
      const sandboxEnvs: Record<string, string> = {};
      if (inputContext) {
        // Base64-encode INPUT_CONTEXT to avoid E2B's os.environ injection breaking
        // on special characters (single quotes, backslashes, etc.)
        // Base64 only produces A-Za-z0-9+/= which are always safe
        const b64 = Buffer.from(inputContext, 'utf-8').toString('base64');
        sandboxEnvs['INPUT_CONTEXT_B64'] = b64;
      }
      for (const token of tokens) {
        const envKey = `${token.provider.toUpperCase()}_ACCESS_TOKEN`;
        sandboxEnvs[envKey] = token.access_token;
      }
      // Inject API keys for search and other services
      if (process.env.TAVILY_API_KEY) sandboxEnvs['TAVILY_API_KEY'] = process.env.TAVILY_API_KEY;
      if (process.env.SERPAPI_KEY) sandboxEnvs['SERPAPI_KEY'] = process.env.SERPAPI_KEY;
      if (process.env.SENDGRID_API_KEY) sandboxEnvs['SENDGRID_API_KEY'] = process.env.SENDGRID_API_KEY;
      if (process.env.TWITTER_BEARER_TOKEN) sandboxEnvs['TWITTER_BEARER_TOKEN'] = process.env.TWITTER_BEARER_TOKEN;
      if (process.env.FACEBOOK_APP_ID) sandboxEnvs['FACEBOOK_APP_ID'] = process.env.FACEBOOK_APP_ID;

      // Only apply dry-run guard for write-op agents — read-only agents run directly
      if (hasWriteOps) {
        sandboxEnvs['AF_DRY_RUN'] = '1';
      }

      // Prepend import of input context from env — available as `_input` (raw string) and `_input_data` (parsed JSON)
      const wrappedCode = `import os, sys, json, base64
try:
    _b64 = os.environ.get('INPUT_CONTEXT_B64', '')
    _input = base64.b64decode(_b64).decode('utf-8') if _b64 else '{}'
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

import matplotlib
matplotlib.use('Agg')

${pythonCode}`;

      // Execute in E2B cloud sandbox (pre-warmed, <1s start time)
      const sandbox = await Sandbox.create({
        apiKey: process.env.E2B_API_KEY,
        timeoutMs: 120_000,  // 2 minute timeout
      });

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
        const execution = await sandbox.runCode(safeCode, { envs: sandboxEnvs });

        const stdout = execution.logs.stdout.join('\n').trim();
        const stderr = execution.logs.stderr.join('\n').trim();

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
                const adminEmail = process.env.ADMIN_EMAIL || 'niranjanant7@gmail.com';
                const tenantEmail = await getTenantEmail();
                await sendEmail({
                  to: adminEmail,
                  subject: `⚠️ Missing Permission — ${signal.__missing_permission__.provider}`,
                  body: `A mission requires a connector that isn't configured.\n\nProvider: ${signal.__missing_permission__.provider}\nTenant: ${tenantEmail || tenantId}\nAgent: ${agent.role}\n\nPlease add this connector or contact the customer.`,
                });
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
              
              // Log the billing event for credit deduction
              try {
                await supabase.from('events').insert({
                  tenant_id: tenantId,
                  event_type: 'billing.social_api_call',
                  entity_type: 'agent',
                  entity_id: agent.id,
                  payload: {
                    missionId,
                    provider,
                    action,
                    cost_credits,
                    agentRole: agent.role,
                    timestamp: new Date().toISOString(),
                  },
                });
              } catch (billingErr) {
                console.warn(`[Agent ${agent.id}] Billing event insert failed (non-fatal):`, billingErr);
              }
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

        // --- PHASE 3: STRUCTURAL VALIDATION (Lenient) ---
        if (isFinalAgent && expectedOutputFormat) {
          console.log(`[Agent ${agent.id}] Validating final output against expected format...`);
          const validationPrompt = `
You are a LENIENT data validation agent.
The user expected the output to roughly follow this schema:
${expectedOutputFormat}

The agent generated this JSON output:
${finalOutputJSON}

VALIDATION RULES (be lenient):
1. PASS if the core required fields from the schema are present (even if extra fields exist)
2. PASS if the data types are correct for the core fields
3. Extra keys are ALWAYS OK — agents often add useful metadata like "answer", "html_report", "summary", etc.
4. Status values like "no_email", "failed:...", "skipped" are all valid — don't reject for status wording
5. FAIL ONLY if REQUIRED core fields are completely missing or have wrong data types
6. An empty array [] is valid for "results" if the search found nothing
7. Do NOT reject for having MORE data than expected

Respond: {"valid": boolean, "reason": "string if invalid"}
          `;
          const validationResult = await callLLM([{ role: 'user', content: validationPrompt }], { temperature: 0, jsonMode: true, tier: 3 });
          const validationParsed = JSON.parse(validationResult.content);
          if (!validationParsed.valid) {
            throw new Error(`Output failed structural validation against the expected format. Reason: ${validationParsed.reason}`);
          }
          console.log(`[Agent ${agent.id}] Validation passed!`);
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
          'todo: implement',
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
            payload: { output: finalOutputJSON, pythonCode, writeRisk, runNumber: isTrainingMode ? trainingRunNumber : undefined },
            status: 'pending'
          });

          throw new Error('PausedForApproval');
        }

        // No approval needed — proceed to Phase 2 if this agent has write ops
        // (read-only agents and reversible-write agents under conditional
        // trust, plus any agent under autonomous trust, land here directly).
        if (hasWriteOps) {
          finalOutputJSON = await runRealSideEffects(pythonCode, sandboxEnvs, finalOutputJSON, agent.id);
        } else {
          console.log(`[Agent ${agent.id}] No write operations detected — skipping Phase 2.`);
        }

        await supabase.from('events').insert({
          tenant_id: tenantId,
          event_type: 'agent.completed',
          entity_type: 'agent',
          entity_id: agent.id,
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
    }
  }

  throw new Error(`Agent "${agent.role}" failed after ${maxAttempts} attempts. ${lastError}`);
}
