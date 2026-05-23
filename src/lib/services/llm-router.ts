// ============================================================
// LLM Router — Multi-provider support
//
// Priority: Anthropic (Claude) → Gemini → OpenAI
// Claude is best for code generation & agentic reasoning.
// Falls back gracefully based on which API keys are available.
// ============================================================

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  content: string;
  provider: string;
  tokensUsed: number;
}

/**
 * Call the best available LLM provider.
 * Returns parsed JSON content string.
 * If budgetContext is provided, enforces token/cost budgets via circuit breaker.
 */
export async function callLLM(
  messages: LLMMessage[],
  options: { temperature?: number; jsonMode?: boolean; tier?: 1 | 2 | 3; budgetContext?: { tenantId: string; missionId: string } } = {}
): Promise<LLMResponse> {
  const { temperature = 0.3, jsonMode = true, tier = 2, budgetContext } = options;

  // Circuit breaker gate: check before calling any LLM
  if (budgetContext) {
    const { checkCircuit, recordFailure } = await import('@/lib/middleware/circuit-breaker');
    const estimatedTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0) + 500;
    const check = checkCircuit(budgetContext.tenantId, budgetContext.missionId, estimatedTokens);
    
    if (!check.allowed) {
      throw new Error(`Circuit breaker OPEN: ${check.reason}`);
    }
  }

  let result: LLMResponse | null = null;

  // ═══════════════════════════════════════════════════════════
  // LLM Priority: Anthropic (Claude) → Gemini → OpenAI
  //
  // Why this order:
  // 1. Claude — Best for code generation, structured reasoning,
  //    and agentic tasks. Produces the most reliable Python scripts.
  // 2. Gemini — Strong general reasoning, fast, good JSON mode.
  //    Excellent cost/quality for blueprint generation.
  // 3. OpenAI — Reliable fallback with broad compatibility.
  // ═══════════════════════════════════════════════════════════

  // ── 1st: Try Anthropic Claude (best for code generation) ──
  if (!result && process.env.ANTHROPIC_API_KEY) {
    try {
      result = await callAnthropic(messages, temperature, tier, jsonMode);
    } catch (err) {
      console.warn('[LLM] Anthropic (Claude) failed, trying Gemini fallback:', (err as Error).message);
      if (budgetContext) {
        const { recordFailure } = await import('@/lib/middleware/circuit-breaker');
        recordFailure(budgetContext.tenantId);
      }
    }
  }

  // ── 2nd: Try Gemini (strong reasoning, fast) ──
  if (!result && process.env.GEMINI_API_KEY) {
    try {
      result = await callGemini(messages, temperature, jsonMode, tier);
    } catch (err) {
      console.warn('[LLM] Gemini failed, trying OpenAI fallback:', (err as Error).message);
      if (budgetContext) {
        const { recordFailure } = await import('@/lib/middleware/circuit-breaker');
        recordFailure(budgetContext.tenantId);
      }
    }
  }

  // ── 3rd: Try OpenAI (reliable fallback) ──
  if (!result && process.env.OPENAI_API_KEY) {
    try {
      result = await callOpenAI(messages, temperature, jsonMode, tier);
    } catch (err) {
      console.warn('[LLM] OpenAI failed, no more fallbacks:', (err as Error).message);
      if (budgetContext) {
        const { recordFailure } = await import('@/lib/middleware/circuit-breaker');
        recordFailure(budgetContext.tenantId);
      }
    }
  }

  if (!result) {
    throw new Error('No LLM provider available. Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY.');
  }

  // Record successful usage
  if (budgetContext && result.tokensUsed > 0) {
    const { recordUsage } = await import('@/lib/middleware/circuit-breaker');
    await recordUsage(budgetContext.tenantId, budgetContext.missionId, result.tokensUsed, 'llm_call');
  }

  return result;
}

// ── Gemini (via REST API — no SDK dependency) ──
async function callGemini(messages: LLMMessage[], temperature: number, jsonMode: boolean, tier: number): Promise<LLMResponse> {
  const apiKey = process.env.GEMINI_API_KEY!;
  // Model tier mapping (2025+ stable identifiers):
  // Tier 1 (Pro/Enterprise): Best quality — gemini-2.5-pro
  // Tier 2 (Individual):     Balanced     — gemini-2.5-flash
  // Tier 3 (Free):           Fast/cheap   — gemini-2.0-flash
  const model = tier === 1 ? 'gemini-2.5-pro' : tier === 2 ? 'gemini-2.5-flash' : 'gemini-2.0-flash';

  // Convert messages to Gemini format
  const systemInstruction = messages.find(m => m.role === 'system')?.content || '';
  let contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  if (contents.length === 0) {
    contents = [{ role: 'user', parts: [{ text: 'Please proceed with the system instructions.' }] }];
  }

  const body: Record<string, unknown> = {
    contents,
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
    generationConfig: {
      temperature,
      maxOutputTokens: 4096,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const tokensUsed = data.usageMetadata?.totalTokenCount || 0;

  return { content, provider: 'gemini', tokensUsed };
}

// ── OpenAI ──
async function callOpenAI(messages: LLMMessage[], temperature: number, jsonMode: boolean, tier: number): Promise<LLMResponse> {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // Model tier mapping (2025+ stable identifiers):
  // Tier 1 (Pro/Enterprise): Best quality — gpt-4o
  // Tier 2 (Individual):     Balanced     — gpt-4o
  // Tier 3 (Free):           Fast/cheap   — gpt-4o-mini
  const modelName = tier === 1 ? 'gpt-4o' : tier === 2 ? 'gpt-4o' : 'gpt-4o-mini';

  // OpenAI strictly requires the word "json" in the prompt when using json_object format
  if (jsonMode) {
    const sysMsg = messages.find(m => m.role === 'system');
    if (sysMsg && !sysMsg.content.toLowerCase().includes('json')) {
      sysMsg.content += '\\n\\nPlease output valid JSON.';
    } else if (!sysMsg) {
      messages.unshift({ role: 'system', content: 'Please output valid JSON.' });
    }
  }

  const completion = await openai.chat.completions.create({
    model: modelName,
    temperature,
    ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    messages,
  });

  return {
    content: completion.choices[0].message.content || '',
    provider: 'openai',
    tokensUsed: completion.usage?.total_tokens || 0,
  };
}

// ── Anthropic (via REST API) ──
// NOTE: Claude has NO native JSON mode like OpenAI/Gemini.
// We handle this by: (1) injecting JSON instruction in system prompt,
// (2) post-processing to strip markdown code block wrappers.
async function callAnthropic(messages: LLMMessage[], temperature: number, tier: number, jsonMode: boolean = false): Promise<LLMResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  let systemMsg = messages.find(m => m.role === 'system')?.content || '';
  
  // When jsonMode is requested, explicitly tell Claude to output raw JSON only
  if (jsonMode && !systemMsg.includes('respond ONLY with valid JSON')) {
    systemMsg += '\n\nIMPORTANT: You MUST respond ONLY with valid JSON. Do NOT wrap it in markdown code blocks (no ```json). Do NOT add any text before or after the JSON. Output raw JSON only.';
  }

  const userMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
  
  // Anthropic requires at least one message
  if (userMessages.length === 0) {
    userMessages.push({ role: 'user', content: 'Please proceed with the system instructions.' });
  }

  // Model tier mapping (2025+ stable identifiers):
  // Tier 1 (Pro/Enterprise): Best quality — claude-sonnet-4-20250514
  // Tier 2 (Individual):     Balanced     — claude-3-5-sonnet-20241022
  // Tier 3 (Free):           Fast/cheap   — claude-3-5-haiku-20241022
  const modelName = tier === 1 ? 'claude-sonnet-4-20250514' : tier === 2 ? 'claude-3-5-sonnet-20241022' : 'claude-3-5-haiku-20241022';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 4096,
      temperature,
      system: systemMsg,
      messages: userMessages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  let content = data.content?.[0]?.text || '';
  const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

  // Post-process: extract JSON if Claude wraps it in markdown code blocks
  if (jsonMode) {
    content = extractJsonFromResponse(content);
  }

  return { content, provider: 'anthropic', tokensUsed };
}

/**
 * Extract raw JSON from LLM responses that may include markdown wrappers.
 * Handles: ```json\n{...}\n```, ```\n{...}\n```, or raw JSON.
 */
function extractJsonFromResponse(text: string): string {
  const trimmed = text.trim();
  
  // Already valid JSON — return as-is
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && 
      (trimmed.endsWith('}') || trimmed.endsWith(']'))) {
    return trimmed;
  }
  
  // Strip ```json ... ``` or ``` ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  
  // Try to find JSON object/array in the text
  const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  
  // Last resort: return as-is and let the caller handle parse errors
  return trimmed;
}

// ── Embeddings (for vector memory — use OpenAI or fallback) ──
export async function generateEmbedding(text: string): Promise<number[] | null> {
  // Try OpenAI embeddings first
  if (process.env.OPENAI_API_KEY) {
    try {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return res.data[0].embedding;
    } catch {
      // Fall through
    }
  }

  // Gemini embeddings via REST
  if (process.env.GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: { parts: [{ text }] },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const values: number[] | null = data.embedding?.values || null;
        if (values) {
          // Gemini text-embedding-004 outputs 768 dims; pad to 1536 to match our pgvector column
          while (values.length < 1536) values.push(0);
          return values.slice(0, 1536);
        }
        return null;
      }
    } catch {
      // Fall through
    }
  }

  return null; // Vector memory unavailable — graceful degradation
}
