/**
 * Approval Gate Tests
 *
 * Critical safety tests for the two-phase dry-run / human-approval flow.
 * A regression here means real side effects (email sends, social posts, DB writes)
 * could execute without human review — the most dangerous possible regression.
 *
 * These tests focus on the pure logic layer (classifyAgentActions, action pattern
 * matching) without spinning up E2B sandboxes or hitting Supabase.
 */

import { describe, it, expect } from 'vitest';
import { classifyAgentActions, type ActionRisk } from '../agent-loop';

// ── Helpers ────────────────────────────────────────────────────────────────

function expectRisk(code: string, expected: ActionRisk) {
  const result = classifyAgentActions(code);
  expect(result.writeRisk, `Code:\n${code}`).toBe(expected);
}

function expectWriteOps(code: string, expected: boolean) {
  const result = classifyAgentActions(code);
  expect(result.hasWriteOps, `Code:\n${code}`).toBe(expected);
}

// ── Read-only agents: should bypass dry-run (one sandbox, no approval) ────

describe('classifyAgentActions — read-only', () => {
  it('pure data fetch is read-only', () => {
    expectRisk(`result = api.call('github', 'GET', '/repos')`, 'read');
    expectWriteOps(`result = api.call('github', 'GET', '/repos')`, false);
  });

  it('multiple GET calls are still read-only', () => {
    const code = `
      repos = api.call('github', 'GET', '/user/repos')
      issues = api.call('github', 'GET', '/repos/x/issues')
    `;
    expectRisk(code, 'read');
    expectWriteOps(code, false);
  });

  it('composio_execute read call is read-only', () => {
    const code = `result = composio_execute('GITHUB_GET_REPOSITORIES', {})`;
    expectRisk(code, 'read');
  });

  it('data transformation with no API calls is read-only', () => {
    const code = `
      import json
      data = [{'name': 'foo', 'score': 42}]
      filtered = [x for x in data if x['score'] > 10]
      print(json.dumps(filtered))
    `;
    expectRisk(code, 'read');
    expectWriteOps(code, false);
  });
});

// ── Write-reversible: creates/updates a private resource, approval required ─

describe('classifyAgentActions — write_reversible', () => {
  it('Google Sheets create requires approval', () => {
    expectRisk(`sheets.create('Report Q3', data)`, 'write_reversible');
    expectWriteOps(`sheets.create('Report Q3', data)`, true);
  });

  it('Google Sheets update requires approval', () => {
    expectRisk(`sheets.update(sheet_id, range, values)`, 'write_reversible');
  });

  it('Google Drive upload requires approval', () => {
    expectRisk(`drive.upload('report.pdf', content)`, 'write_reversible');
  });

  it('Gmail draft (not send) is reversible', () => {
    expectRisk(`gmail.draft(to, subject, body)`, 'write_reversible');
    expectWriteOps(`gmail.draft(to, subject, body)`, true);
  });

  it('GitHub issue creation is reversible', () => {
    expectRisk(`api.github_create_issue(repo, title, body)`, 'write_reversible');
  });

  it('Notion page creation is reversible', () => {
    expectRisk(`api.notion_create_page(parent_id, title, content)`, 'write_reversible');
  });

  it('HTTP PUT is reversible', () => {
    expectRisk(`result = _request("PUT", url, data)`, 'write_reversible');
  });

  it('HTTP PATCH is reversible', () => {
    expectRisk(`result = _request("PATCH", url, {'status': 'done'})`, 'write_reversible');
  });

  it('generic requests.post to non-communication endpoint is reversible', () => {
    expectRisk(`requests.post('https://api.notion.so/v1/pages', json=payload)`, 'write_reversible');
  });
});

// ── Write-irreversible: communications & destructive — requires approval ───

describe('classifyAgentActions — write_irreversible', () => {
  it('gmail.send is irreversible', () => {
    expectRisk(`gmail.send(to, subject, body)`, 'write_irreversible');
    expectWriteOps(`gmail.send(to, subject, body)`, true);
  });

  it('Slack message send is irreversible', () => {
    expectRisk(`api.slack_send(channel, message)`, 'write_irreversible');
  });

  it('LinkedIn post is irreversible', () => {
    expectRisk(`social.post_linkedin(content)`, 'write_irreversible');
  });

  it('Twitter/X post is irreversible', () => {
    expectRisk(`social.post_tweet(text)`, 'write_irreversible');
  });

  it('Instagram post is irreversible', () => {
    expectRisk(`social.post_instagram(caption, image_url)`, 'write_irreversible');
  });

  it('Calendar event creation is irreversible', () => {
    expectRisk(`calendar.create(title, start, end, attendees)`, 'write_irreversible');
  });

  it('HTTP DELETE is irreversible', () => {
    expectRisk(`result = _request("DELETE", resource_url)`, 'write_irreversible');
  });

  it('requests.delete is irreversible', () => {
    expectRisk(`requests.delete(url)`, 'write_irreversible');
  });

  it('notify_user is irreversible', () => {
    expectRisk(`notify_user('Mission complete!')`, 'write_irreversible');
  });

  it('LinkedIn delete is irreversible', () => {
    expectRisk(`social.delete_linkedin_post(post_id)`, 'write_irreversible');
  });
});

// ── Mixed code: highest risk wins ──────────────────────────────────────────

describe('classifyAgentActions — risk escalation (highest wins)', () => {
  it('irreversible dominates reversible in same agent', () => {
    const code = `
      sheet_id = sheets.create('Draft', data)      # reversible
      gmail.send(to, 'Your report', body)           # irreversible
    `;
    expectRisk(code, 'write_irreversible');
    expectWriteOps(code, true);
  });

  it('reversible dominates read in same agent', () => {
    const code = `
      repos = api.call('github', 'GET', '/user/repos')   # read
      api.github_create_issue(repo, 'Bug found', body)   # reversible
    `;
    expectRisk(code, 'write_reversible');
    expectWriteOps(code, true);
  });

  it('read + irreversible → irreversible', () => {
    const code = `
      data = api.call('slack', 'GET', '/channels')
      api.slack_send('#general', message)
    `;
    expectRisk(code, 'write_irreversible');
  });
});

// ── Composio-specific patterns ──────────────────────────────────────────────

describe('classifyAgentActions — generic api.call() classification', () => {
  it('communication provider POST → irreversible even without explicit send pattern', () => {
    const code = `result = api.call('gmail', 'POST', '/messages/send')`;
    expectRisk(code, 'write_irreversible');
  });

  it('storage provider POST → reversible (creates private resource)', () => {
    const code = `result = api.call('notion', 'POST', '/pages')`;
    expectRisk(code, 'write_reversible');
  });

  it('endpoint with "send" in path → irreversible', () => {
    const code = `result = api.call('twilio', 'POST', '/messages/send')`;
    expectRisk(code, 'write_irreversible');
  });

  it('endpoint with "publish" in path → irreversible', () => {
    const code = `result = api.call('hubspot', 'POST', '/publish')`;
    expectRisk(code, 'write_irreversible');
  });

  it('github GET → read', () => {
    const code = `result = api.call('github', 'GET', '/repos/owner/repo')`;
    expectRisk(code, 'read');
  });
});

// ── Composio-managed providers (how every OAuth connector is called) ────────

describe('classifyAgentActions — composio_execute', () => {
  const cx = (slug: string) => `result = composio_execute("${slug}", {"x": 1})`;

  it.each([
    'GMAIL_SEND_EMAIL', 'GMAIL_REPLY_TO_THREAD', 'SLACK_CHAT_POST_MESSAGE',
    'SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL', 'LINKEDIN_CREATE_LINKED_IN_POST',
    'GOOGLECALENDAR_CREATE_EVENT', 'AIRTABLE_DELETE_RECORD', 'GITHUB_MERGE_A_PULL_REQUEST',
    'YOUTUBE_UPLOAD_VIDEO',
  ])('%s needs approval as irreversible', (slug) => {
    expectRisk(cx(slug), 'write_irreversible');
  });

  it.each([
    'GOOGLESHEETS_CREATE_GOOGLE_SHEET1', 'GOOGLESHEETS_VALUES_UPDATE', 'GOOGLEDOCS_CREATE_DOCUMENT',
    'NOTION_CREATE_NOTION_PAGE', 'HUBSPOT_CREATE_CONTACT', 'GITHUB_CREATE_AN_ISSUE',
    'GMAIL_CREATE_EMAIL_DRAFT',
  ])('%s needs approval as reversible', (slug) => {
    expectRisk(cx(slug), 'write_reversible');
  });

  it.each([
    'GITHUB_LIST_PULL_REQUESTS', 'GMAIL_FETCH_EMAILS', 'HUBSPOT_SEARCH_DEALS', 'GOOGLEDOCS_GET_DOCUMENT_BY_ID',
    // read verb not in second position
    'GOOGLECALENDAR_EVENTS_LIST', 'GITHUB_REPOS_GET_CONTENT', 'GOOGLESHEETS_BATCH_GET', 'NOTION_QUERY_DATABASE',
    'GITHUB_WHO_AM_I',
  ])(
    '%s is read-only', (slug) => {
      expectRisk(cx(slug), 'read');
      expectWriteOps(cx(slug), false);
    });

  it('a read verb anywhere does not make a write action a read', () => {
    expectRisk(cx('GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND'), 'write_reversible');
    expectWriteOps(cx('GITHUB_GET_OR_CREATE_LABEL'), true);
    expectWriteOps(cx('HUBSPOT_ARCHIVE_DEALS'), true);
    expectWriteOps(cx('SLACK_CONVERSATIONS_OPEN'), true); // no recognised verb → treated as a write
  });

  it('a read followed by a send is irreversible', () => {
    expectRisk(`${cx('GMAIL_FETCH_EMAILS')}\n${cx('GMAIL_SEND_EMAIL')}`, 'write_irreversible');
  });

  it('an action name held in a variable requires review', () => {
    expectWriteOps(`action = "GMAIL_" + verb\ncomposio_execute(action, params)`, true);
  });
});

// ── Dry-run safety invariant ────────────────────────────────────────────────
// Documents the contract: when AF_DRY_RUN=1, write ops must NOT execute.
// This test verifies the detection side (classifyAgentActions correctly
// identifies write ops that will be gated before the real sandbox runs).

describe('approval gate contract', () => {
  it('every irreversible pattern triggers hasWriteOps=true (dry-run gate activates)', () => {
    const irreversiblePatterns = [
      `gmail.send(to, sub, body)`,
      `api.slack_send(ch, msg)`,
      `social.post_linkedin(txt)`,
      `social.post_tweet(txt)`,
      `calendar.create(t, s, e, [])`,
      `notify_user('done')`,
      `_request("DELETE", url)`,
      `requests.delete(url)`,
    ];
    for (const code of irreversiblePatterns) {
      const result = classifyAgentActions(code);
      expect(result.hasWriteOps, `Pattern not gated: ${code.trim()}`).toBe(true);
      expect(result.writeRisk, `Wrong risk for: ${code.trim()}`).toBe('write_irreversible');
    }
  });

  it('pure-read code does NOT trigger dry-run gate (single sandbox path)', () => {
    const readOnlyPatterns = [
      `result = api.call('github', 'GET', '/repos')`,
      `data = json.loads(input_context)`,
      `output = {'summary': 'done'}`,
    ];
    for (const code of readOnlyPatterns) {
      const result = classifyAgentActions(code);
      expect(result.hasWriteOps, `Wrongly gated: ${code.trim()}`).toBe(false);
    }
  });
});
