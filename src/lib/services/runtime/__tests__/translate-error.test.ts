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
