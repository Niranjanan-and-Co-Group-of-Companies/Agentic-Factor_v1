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
    .select('status, payload')
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
      throw new Error('Action rejected by human.');
    }
    if (existingAction.status === 'approved' && existingAction.payload && existingAction.payload.output !== undefined) {
      console.log(`[Agent ${agent.id}] Resuming execution with approved payload.`);
      return { output: existingAction.payload.output, finalCode: agent.pythonScript || '' };
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
    } else if (attempts === 1 && agent.pythonScript && agent.pythonScript.trim() !== '') {
      console.log(`[Agent ${agent.id}] Executing predefined pythonScript from blueprint.`);
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

    try {
      console.log(`[Agent ${agent.id}] Running E2B sandbox, attempt ${attempts}...`);

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
        // Install common packages + agenticfactor SDK (suppress all output to prevent stdout pollution)
        await sandbox.runCode(
          'import subprocess, sys; subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "requests", "beautifulsoup4", "google-api-python-client", "google-auth-oauthlib", "openai", "anthropic", "matplotlib", "pandas", "numpy", "openpyxl", "python-docx", "python-pptx", "PyPDF2"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)',
          { envs: sandboxEnvs }
        );

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

        // --- PHASE 3: STRUCTURAL VALIDATION ---
        if (isFinalAgent && expectedOutputFormat) {
          console.log(`[Agent ${agent.id}] Validating final output against expected format...`);
          const validationPrompt = `
You are a strict data validation agent. 
The user requested the final output to follow this expected structural format/schema:
${expectedOutputFormat}

The agent generated this JSON output:
${finalOutputJSON}

Does the generated output structurally match the requested format and fulfill the core requirements? 
Check for schema compliance, correct keys, and data types. Do NOT check for literal data matching (the actual data values can differ from the sample).
Respond with a JSON object: {"valid": boolean, "reason": "string explaining why if invalid"}
          `;
          const validationResult = await callLLM([{ role: 'user', content: validationPrompt }], { temperature: 0, jsonMode: true, tier: 3 });
          const validationParsed = JSON.parse(validationResult.content);
          if (!validationParsed.valid) {
            throw new Error(`Output failed structural validation against the expected format. Reason: ${validationParsed.reason}`);
          }
          console.log(`[Agent ${agent.id}] Validation passed!`);
        }

        // True Payload Approval: Pause AFTER execution if manual
        if (agent.trustLevel === 'manual') {
          console.log(`[Agent ${agent.id}] Trust level is manual. Pausing for human payload approval...`);
          
          await supabase.from('proposed_actions').insert({
            tenant_id: tenantId,
            mission_id: missionId,
            agent_id: agent.id,
            action_type: 'handoff_approval',
            description: `Review output payload for agent ${agent.role} before handoff to next agent.`,
            payload: { output: finalOutputJSON, pythonCode },
            status: 'pending'
          });
          
          throw new Error('PausedForApproval');
        }

        // Conditional trust: pause only for high-risk actions
        if (agent.trustLevel === 'conditional') {
          const outputLower = (finalOutputJSON + ' ' + pythonCode).toLowerCase();
          const HIGH_RISK_PATTERNS = [
            'calendar', 'create_event', 'schedule', 'send_email', 'send_message',
            'delete_file', 'remove', 'payment', 'invoice', 'push', 'deploy',
            'publish', 'offer_letter', 'git push', 'create_repo', 'transfer',
          ];
          const isHighRisk = HIGH_RISK_PATTERNS.some(p => outputLower.includes(p));
          
          if (isHighRisk) {
            console.log(`[Agent ${agent.id}] Conditional trust: HIGH RISK detected. Pausing for approval.`);
            
            await supabase.from('proposed_actions').insert({
              tenant_id: tenantId,
              mission_id: missionId,
              agent_id: agent.id,
              action_type: 'conditional_risk_review',
              description: `⚠️ High-risk action detected in agent "${agent.role}". Please review before continuing.`,
              payload: { output: finalOutputJSON, pythonCode, riskPatterns: HIGH_RISK_PATTERNS.filter(p => outputLower.includes(p)) },
              status: 'pending'
            });
            
            throw new Error('PausedForApproval');
          }
          console.log(`[Agent ${agent.id}] Conditional trust: low risk, auto-approved.`);
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
      lastError = error.message;
      console.error(`[Agent ${agent.id}] E2B execution failed on attempt ${attempts}: ${error.message}`);
    }
  }

  throw new Error(`Agent ${agent.role} failed after ${maxAttempts} attempts. Last error: ${lastError}`);
}
