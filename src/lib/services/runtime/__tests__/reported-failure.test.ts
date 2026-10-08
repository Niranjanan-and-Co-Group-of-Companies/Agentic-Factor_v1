import { describe, it, expect } from 'vitest';
import { reportedFailure } from '../agent-loop';

describe('reportedFailure', () => {
  it('flags a script that caught an API error and printed status failed', () => {
    expect(reportedFailure({
      status: 'failed',
      error: '[NOTION_CREATE_NOTION_PAGE] Cannot create root-level pages via the Notion API.',
    })).toContain('root-level pages');
  });

  it('flags status error and falls back to message', () => {
    expect(reportedFailure({ status: 'ERROR', message: 'quota exceeded' })).toBe('quota exceeded');
  });

  it('flags a failed step even when the overall status looks fine', () => {
    expect(reportedFailure({
      status: 'created', doc_url: 'https://docs.google.com/x', email_status: 'failed',
      error: 'COMPOSIO_ENTITY_ID is not set — cannot execute GMAIL_SEND_EMAIL.',
    })).toContain('COMPOSIO_ENTITY_ID');
    expect(reportedFailure({ status: 'created', slack_status: 'error' })).toBe('"slack_status: error"');
  });

  it('does not flag successful or legitimate partial outcomes', () => {
    expect(reportedFailure({ status: 'created', email_status: 'sent' })).toBeNull();
    expect(reportedFailure({ status: 'success', doc_url: 'https://docs.google.com/x' })).toBeNull();
    expect(reportedFailure({ status: 'failed:no_recipients' })).toBeNull();
    expect(reportedFailure({ status: 'skipped' })).toBeNull();
    expect(reportedFailure({ error: null, rows_written: 20 })).toBeNull();
    expect(reportedFailure([{ status: 'failed' }])).toBeNull();
    expect(reportedFailure('failed')).toBeNull();
  });
});
