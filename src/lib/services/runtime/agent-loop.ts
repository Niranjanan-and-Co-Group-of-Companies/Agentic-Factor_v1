import { callLLM } from '../llm-router';
import { executeTool } from '../tools';
import { createServiceClient } from '@/lib/supabase/server';
import { Sandbox } from '@e2b/code-interpreter';

interface AgentConfig {
  id: string;
  role: string;
  systemPrompt: string;
  tools: { name: string; type: string }[];
  handoffProtocol?: string;
  pythonScript?: string;
  trustLevel?: 'manual' | 'conditional' | 'autonomous';
}

export async function executeAgent(
  tenantId: string,
  missionId: string,
  agent: AgentConfig,
  inputContext: string,
  tokens: { provider: string, access_token: string }[] = []
): Promise<{ output: string; finalCode: string }> {
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
  const maxAttempts = 3;
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

INSTRUCTIONS:
1. Write a complete, self-contained Python script to accomplish this task.
2. The script MUST print the final output as a valid JSON string to standard output (stdout).
3. Do NOT print anything else to stdout. Use sys.stderr.write() for any debugging or logs.
4. If you need to authenticate with APIs, the following OAuth access tokens are available as environment variables: ${envKeys || 'None'}
   (e.g., use os.environ.get("GOOGLE_ACCESS_TOKEN"))
5. **CRITICAL STRICT RULE**: NEVER output simulated, mocked, or placeholder data. You MUST execute the real API requests using the provided credentials and real logic. If you output mock data, the entire mission will fail.
6. Enclose your Python code inside a triple-backtick block with 'python' as the language identifier.
7. **WARNING ON WEB SCRAPING**: If you use \`requests\` to fetch generic web pages or news sites, remember they return HTML! Do NOT call \`.json()\` on the response unless you are querying a dedicated JSON API. Use BeautifulSoup to parse HTML.
8. **DO NOT CATCH FATAL ERRORS**: If your script fails or encounters an exception, DO NOT catch it and print it as JSON to stdout! Let the script crash naturally. The orchestrator will catch the traceback and allow you to fix your code in the next attempt.`;

      const response = await callLLM(
        [{ role: 'system', content: systemPrompt }], 
        { temperature: 0.1, jsonMode: false, tier: 1 }
      );
      
      const regex = new RegExp('```python\\n([\\s\\S]*?)```');
      const codeMatch = response.content.match(regex);
      if (!codeMatch) {
        lastError = "Failed to extract Python code from LLM response. Make sure to use triple-backtick python blocks.";
        console.warn(`[Agent ${agent.id} attempt ${attempts}] LLM returned no python block.`);
        continue;
      }
      
      pythonCode = codeMatch[1];
    }

    lastPythonCode = pythonCode;

    try {
      console.log(`[Agent ${agent.id}] Running E2B sandbox, attempt ${attempts}...`);

      // Build environment variables for the sandbox
      const sandboxEnvs: Record<string, string> = {};
      if (inputContext) sandboxEnvs['INPUT_CONTEXT'] = inputContext;
      for (const token of tokens) {
        const envKey = `${token.provider.toUpperCase()}_ACCESS_TOKEN`;
        sandboxEnvs[envKey] = token.access_token;
      }

      // Prepend import of input context from env
      const wrappedCode = `import os, sys, json
try:
    _input = os.environ.get('INPUT_CONTEXT', '{}')
except:
    _input = '{}'

${pythonCode}`;

      // Execute in E2B cloud sandbox (pre-warmed, <1s start time)
      const sandbox = await Sandbox.create({
        apiKey: process.env.E2B_API_KEY,
        timeoutMs: 120_000,  // 2 minute timeout
      });

      try {
        // Install common packages
        await sandbox.runCode(
          'import subprocess; subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "requests", "google-api-python-client", "google-auth-oauthlib", "openai", "anthropic"])',
          { envs: sandboxEnvs }
        );

        // Execute the agent's Python script
        const execution = await sandbox.runCode(wrappedCode, { envs: sandboxEnvs });

        const stdout = execution.logs.stdout.join('\n').trim();
        const stderr = execution.logs.stderr.join('\n').trim();

        if (execution.error) {
          throw new Error(`E2B execution error: ${execution.error.name}: ${execution.error.value}\n${execution.error.traceback}`);
        }

        if (stderr && !stdout) {
          console.warn(`[Agent ${agent.id} stderr]:`, stderr);
        }

        // Check if stdout is valid JSON
        let finalOutputJSON = '';
        try {
          finalOutputJSON = stdout;
          JSON.parse(finalOutputJSON);
        } catch (e) {
          throw new Error(`Script succeeded but output was not valid JSON. Output was: ${stdout}`);
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
          payload: { missionId, output: stdout },
        });

        return { output: stdout, finalCode: pythonCode };

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
