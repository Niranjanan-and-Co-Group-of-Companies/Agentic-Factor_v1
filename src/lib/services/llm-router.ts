// ============================================================
// LLM Router — Self-Healing Multi-Provider Support
//
// Priority: Anthropic (Claude) → Gemini → OpenAI
// Each provider has a fallback chain of models per tier.
// If a model is deprecated/unavailable (404), the system:
//   1. Automatically tries the next model in the chain
//   2. Caches the working model for 1 hour
//   3. After cache expires, retries the best model first
// ============================================================

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  content: string;
  provider: string;
  model: string;        // Actual model used (for credit billing)
  tokensUsed: number;
}

// ── Self-Healing Model Fallback Chains ──
// Each tier has a priority-ordered list of models per provider.
// Best model first → fallback → last resort.
// When a model returns 404, we skip to the next one and cache the result.
const MODEL_CHAINS: Record<string, Record<number, string[]>> = {
  anthropic: {
    1: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
    2: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
    3: ['claude-3-5-haiku-20241022'],
  },
  gemini: {
    1: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    2: ['gemini-2.5-flash', 'gemini-2.0-flash'],
    3: ['gemini-2.0-flash'],
  },
  openai: {
    1: ['gpt-4o', 'gpt-4o-mini'],
    2: ['gpt-4o', 'gpt-4o-mini'],
    3: ['gpt-4o-mini'],
  },
};

// ── Model Health Cache ──
// Remembers which model worked for each provider+tier combo.
// Expires after 1 hour so we periodically retry better models.
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const modelHealthCache = new Map<string, { model: string; timestamp: number }>();

function getCachedModel(provider: string, tier: number): string | null {
  const key = `${provider}:${tier}`;
  const cached = modelHealthCache.get(key);
  if (cached && (Date.now() - cached.timestamp) < MODEL_CACHE_TTL_MS) {
    return cached.model;
  }
  // Cache expired or doesn't exist — return null to force retry from top
  modelHealthCache.delete(key);
  return null;
}

function setCachedModel(provider: string, tier: number, model: string): void {
  modelHealthCache.set(`${provider}:${tier}`, { model, timestamp: Date.now() });
}

// ── Credit cost mapping based on actual model used ──
// This ensures billing matches the ACTUAL model, not the requested tier.
export function getModelCreditCost(model: string): number {
  // Premium models (5 credits)
  const premiumModels = ['claude-sonnet-4', 'gemini-2.5-pro', 'gpt-4o'];
  // Pro models (3 credits)
  const proModels = ['claude-3-5-sonnet', 'gemini-2.5-flash'];
  // Flash models (1 credit)
  const flashModels = ['claude-3-5-haiku', 'gemini-2.0-flash', 'gpt-4o-mini'];

  if (premiumModels.some(m => model.includes(m))) return 5;
  if (proModels.some(m => model.includes(m))) return 3;
  if (flashModels.some(m => model.includes(m))) return 1;
  return 1; // Default to flash cost
}

/**
 * Call the best available LLM provider with self-healing fallback.
 * Returns the response including the actual model used for credit billing.
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
  // Each provider now has self-healing model fallback chains.
  // ═══════════════════════════════════════════════════════════

  // ── 1st: Try Anthropic Claude ──
  if (!result && process.env.ANTHROPIC_API_KEY) {
    try {
      result = await callAnthropicWithFallback(messages, temperature, tier, jsonMode);
    } catch (err) {
      console.warn('[LLM] All Anthropic models failed, trying Gemini:', (err as Error).message);
      if (budgetContext) {
        const { recordFailure } = await import('@/lib/middleware/circuit-breaker');
        recordFailure(budgetContext.tenantId);
      }
    }
  }

  // ── 2nd: Try Gemini ──
  if (!result && process.env.GEMINI_API_KEY) {
    try {
      result = await callGeminiWithFallback(messages, temperature, jsonMode, tier);
    } catch (err) {
      console.warn('[LLM] All Gemini models failed, trying OpenAI:', (err as Error).message);
      if (budgetContext) {
        const { recordFailure } = await import('@/lib/middleware/circuit-breaker');
        recordFailure(budgetContext.tenantId);
      }
    }
  }

  // ── 3rd: Try OpenAI ──
  if (!result && process.env.OPENAI_API_KEY) {
    try {
      result = await callOpenAIWithFallback(messages, temperature, jsonMode, tier);
    } catch (err) {
      console.warn('[LLM] All OpenAI models failed, no more fallbacks:', (err as Error).message);
      if (budgetContext) {
        const { recordFailure } = await import('@/lib/middleware/circuit-breaker');
        recordFailure(budgetContext.tenantId);
      }
    }
  }

  if (!result) {
    throw new Error('No LLM provider available. All models in all providers failed. Check API keys and model availability.');
  }

  // Record successful usage
  if (budgetContext && result.tokensUsed > 0) {
    const { recordUsage } = await import('@/lib/middleware/circuit-breaker');
    await recordUsage(budgetContext.tenantId, budgetContext.missionId, result.tokensUsed, 'llm_call');
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// Self-Healing Provider Functions
// Each tries models in priority order with caching.
// ═══════════════════════════════════════════════════════════

// ── Anthropic with Fallback Chain ──
async function callAnthropicWithFallback(messages: LLMMessage[], temperature: number, tier: number, jsonMode: boolean): Promise<LLMResponse> {
  const chain = MODEL_CHAINS.anthropic[tier] || MODEL_CHAINS.anthropic[3];
  const cachedModel = getCachedModel('anthropic', tier);
  
  // Reorder chain: put cached model first if it exists
  const modelsToTry = cachedModel 
    ? [cachedModel, ...chain.filter(m => m !== cachedModel)]
    : chain;

  let lastError: Error | null = null;

  for (const modelName of modelsToTry) {
    try {
      const result = await callAnthropicDirect(messages, temperature, modelName, jsonMode);
      setCachedModel('anthropic', tier, modelName);
      console.log(`[LLM] Anthropic model ${modelName} succeeded`);
      return result;
    } catch (err) {
      const errMsg = (err as Error).message;
      // Only try next model if it's a model-not-found error (404)
      if (errMsg.includes('404') || errMsg.includes('not_found') || errMsg.includes('not found')) {
        console.warn(`[LLM] Anthropic model ${modelName} unavailable (404), trying next in chain...`);
        lastError = err as Error;
        continue;
      }
      // For non-404 errors (rate limit, auth, etc.), throw immediately
      throw err;
    }
  }

  throw lastError || new Error('All Anthropic models exhausted');
}

// ── Gemini with Fallback Chain ──
async function callGeminiWithFallback(messages: LLMMessage[], temperature: number, jsonMode: boolean, tier: number): Promise<LLMResponse> {
  const chain = MODEL_CHAINS.gemini[tier] || MODEL_CHAINS.gemini[3];
  const cachedModel = getCachedModel('gemini', tier);
  
  const modelsToTry = cachedModel 
    ? [cachedModel, ...chain.filter(m => m !== cachedModel)]
    : chain;

  let lastError: Error | null = null;

  for (const modelName of modelsToTry) {
    try {
      const result = await callGeminiDirect(messages, temperature, jsonMode, modelName);
      setCachedModel('gemini', tier, modelName);
      console.log(`[LLM] Gemini model ${modelName} succeeded`);
      return result;
    } catch (err) {
      const errMsg = (err as Error).message;
      if (errMsg.includes('404') || errMsg.includes('NOT_FOUND') || errMsg.includes('not found')) {
        console.warn(`[LLM] Gemini model ${modelName} unavailable (404), trying next in chain...`);
        lastError = err as Error;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('All Gemini models exhausted');
}

// ── OpenAI with Fallback Chain ──
async function callOpenAIWithFallback(messages: LLMMessage[], temperature: number, jsonMode: boolean, tier: number): Promise<LLMResponse> {
  const chain = MODEL_CHAINS.openai[tier] || MODEL_CHAINS.openai[3];
  const cachedModel = getCachedModel('openai', tier);
  
  const modelsToTry = cachedModel 
    ? [cachedModel, ...chain.filter(m => m !== cachedModel)]
    : chain;

  let lastError: Error | null = null;

  for (const modelName of modelsToTry) {
    try {
      const result = await callOpenAIDirect(messages, temperature, jsonMode, modelName);
      setCachedModel('openai', tier, modelName);
      console.log(`[LLM] OpenAI model ${modelName} succeeded`);
      return result;
    } catch (err) {
      const errMsg = (err as Error).message;
      if (errMsg.includes('404') || errMsg.includes('model_not_found') || errMsg.includes('does not exist')) {
        console.warn(`[LLM] OpenAI model ${modelName} unavailable (404), trying next in chain...`);
        lastError = err as Error;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('All OpenAI models exhausted');
}

// ═══════════════════════════════════════════════════════════
// Direct Provider Calls (single model, no fallback logic)
// ═══════════════════════════════════════════════════════════

// ── Gemini Direct ──
async function callGeminiDirect(messages: LLMMessage[], temperature: number, jsonMode: boolean, model: string): Promise<LLMResponse> {
  const apiKey = process.env.GEMINI_API_KEY!;

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

  return { content, provider: 'gemini', model, tokensUsed };
}

// ── OpenAI Direct ──
async function callOpenAIDirect(messages: LLMMessage[], temperature: number, jsonMode: boolean, modelName: string): Promise<LLMResponse> {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    model: modelName,
    tokensUsed: completion.usage?.total_tokens || 0,
  };
}

// ── Anthropic Direct ──
async function callAnthropicDirect(messages: LLMMessage[], temperature: number, modelName: string, jsonMode: boolean = false): Promise<LLMResponse> {
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

  return { content, provider: 'anthropic', model: modelName, tokensUsed };
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
