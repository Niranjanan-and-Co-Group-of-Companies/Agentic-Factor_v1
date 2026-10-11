import { describe, it, expect } from 'vitest';
import { translateAgentError } from '../agent-loop';

describe('translateAgentError', () => {
  it('passes critic rejections through unchanged even when they mention 401 or 403', () => {
    const critic = 'Output failed critic review. Reason: the post with 401 likes and 403 comments belongs to another brand.';
    expect(translateAgentError(critic, 'Researcher')).toBe(critic);
  });

  it('still explains real auth failures', () => {
    expect(translateAgentError('HTTP 401 Unauthorized from api.hubspot.com', 'CRM Reader')).toContain('Authentication failed (401)');
    expect(translateAgentError('Request failed: 403 Forbidden', 'Poster')).toContain('Permission denied (403)');
  });

  it('does not read 401 inside a larger number as an auth error', () => {
    expect(translateAgentError('Processed 14012 rows then stopped: KeyError', 'X')).not.toContain('Authentication failed');
  });
});

describe('translateAgentError — provider quota', () => {
  it('names an exhausted web-search quota', () => {
    const msg = translateAgentError(`E2B execution error: APIError: [tavily] HTTP 432: {'detail': {'error': "This request exceeds your plan's set usage limit."}}`, 'Researcher');
    expect(msg).toContain('web-search quota (Tavily) has been used up');
  });
});

describe('status codes are read only where they are status codes', () => {
  it('does not call a traceback line number a permission error', () => {
    const err = 'E2B execution error: RuntimeError: ask_ai output was cut off at max_tokens=350\nCell In[3], line 403\n    texts = ask_ai_batch(prompts)';
    const out = translateAgentError(err, 'Copywriter');
    expect(out).not.toContain('Permission denied');
    expect(out).toContain('ask_ai output was cut off');
  });

  it('still recognises real 403, 401 and 429 replies', () => {
    expect(translateAgentError('[composio_proxy:ZOHO_BOOKS GET /books/v3/reports] HTTP 403: {"message": "not authorized"}', 'X')).toContain('Permission denied (403)');
    expect(translateAgentError('{"error": {"code": 401, "message": "Invalid Credentials"}}', 'X')).toContain('Authentication failed (401)');
    expect(translateAgentError('[SLACK_SEND_MESSAGE] 429 Too Many Requests', 'X')).toContain('Rate limited (429)');
  });
});
