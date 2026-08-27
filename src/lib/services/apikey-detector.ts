// Detects pasted API keys in chat messages and extracts provider + raw key.
// Patterns are ordered most-specific first so sk-ant- is never misclassified
// as an OpenAI sk- key.

export interface DetectedKey {
  provider: string;
  key: string;
}

const KEY_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  // Anthropic — must come before generic sk- pattern
  { pattern: /sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}/g, provider: 'anthropic' },
  // OpenAI project keys (sk-proj-...)
  { pattern: /sk-proj-[A-Za-z0-9_-]{20,}/g, provider: 'openai' },
  // OpenAI org/legacy keys (sk-[48+ alphanum], no dashes after sk-)
  { pattern: /\bsk-[A-Za-z0-9]{48,}\b/g, provider: 'openai' },
  // Google Gemini
  { pattern: /AIza[A-Za-z0-9_-]{35}/g, provider: 'gemini' },
  // Stripe live / test secret keys
  { pattern: /sk_live_[A-Za-z0-9]{24,}/g, provider: 'stripe' },
  { pattern: /sk_test_[A-Za-z0-9]{24,}/g, provider: 'stripe' },
  // SendGrid
  { pattern: /SG\.[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{43,}/g, provider: 'sendgrid' },
  // Replicate
  { pattern: /r8_[A-Za-z0-9]{40}/g, provider: 'replicate' },
  // Tavily
  { pattern: /tvly-[A-Za-z0-9]{20,}/g, provider: 'tavily' },
  // ElevenLabs — 32-char hex
  { pattern: /\b[a-f0-9]{32}\b/g, provider: 'elevenlabs' },
];

export const PROVIDER_LABELS: Record<string, string> = {
  openai:     'OpenAI',
  anthropic:  'Anthropic',
  gemini:     'Gemini',
  stripe:     'Stripe',
  sendgrid:   'SendGrid',
  replicate:  'Replicate',
  tavily:     'Tavily',
  elevenlabs: 'ElevenLabs',
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function detectApiKey(message: string): DetectedKey | null {
  for (const { pattern, provider } of KEY_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(message);
    if (match) return { provider, key: match[0] };
  }
  return null;
}

// Replace the raw key in the user's message with a safe placeholder so it
// is never written to the chat_messages table or shown in conversation history.
export function redactKey(message: string, detected: DetectedKey): string {
  return message.replace(
    detected.key,
    `[${providerLabel(detected.provider)} key — saved securely]`
  );
}
