import { describe, it, expect } from 'vitest';
import { parseResponseShapes } from '../agent-loop';

describe('parseResponseShapes', () => {
  it('lists each reported response shape and skips other or truncated lines', () => {
    const stderr = [
      '[DRY_RUN] Skipped composio_execute(GMAIL_SEND_EMAIL) — write op deferred',
      '__AF_SHAPE__:{"action": "GMAIL_FETCH_EMAILS", "shape": "{\\"messages\\": [{\\"messageId\\": \\"str\\", \\"messageTimestamp\\": \\"str\\"}]}"}',
      '__AF_SHAPE__:{"action": "SLACK_FETCH',
    ].join('\n');
    expect(parseResponseShapes(stderr)).toBe('GMAIL_FETCH_EMAILS → {"messages": [{"messageId": "str", "messageTimestamp": "str"}]}');
    expect(parseResponseShapes('nothing here')).toBe('');
  });
});
