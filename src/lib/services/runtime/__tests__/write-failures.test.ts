import { describe, it, expect } from 'vitest';
import { parseWriteFailures } from '../agent-loop';

describe('parseWriteFailures', () => {
  it('collects reported write failures and ignores other lines', () => {
    const stderr = [
      '[COMPOSIO] something',
      '__AF_WRITE_FAILED__:{"action": "ZOHO_BOOKS POST /invoices", "error": "HTTP 404: Invalid URL Passed"}',
      '__AF_SHAPE__:{"action": "X", "shape": "{}"}',
      '__AF_WRITE_FAILED__:{"action": "GMAIL_SEND',
    ].join('\n');
    expect(parseWriteFailures(stderr)).toEqual([{ action: 'ZOHO_BOOKS POST /invoices', error: 'HTTP 404: Invalid URL Passed' }]);
    expect(parseWriteFailures('')).toEqual([]);
  });
});
