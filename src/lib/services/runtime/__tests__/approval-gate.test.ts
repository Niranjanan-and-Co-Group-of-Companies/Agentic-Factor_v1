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
import { approvalPreview, classifyAgentActions, compactWrites, describeDeferredWrites, inferActionTarget, parseDeferredWrites, proxyWriteLabels, type ActionRisk } from '../agent-loop';

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

// ── Approval card target (icon + label on /approvals) ───────────────────────

describe('inferActionTarget', () => {
  it('uses the write action the script calls, not service names in its text', () => {
    const code = `text = ask_ai("Compare integrations with Slack and GitHub")\ncomposio_execute("GOOGLEDOCS_CREATE_DOCUMENT", {"title": "SWOT"})`;
    expect(inferActionTarget(code, 'Doc Publisher')).toBe('docs');
  });

  it('prefers the riskiest write when there are several', () => {
    const code = `composio_execute("GOOGLEDOCS_CREATE_DOCUMENT", {})\ncomposio_execute("GMAIL_SEND_EMAIL", {})`;
    expect(inferActionTarget(code, 'x')).toBe('gmail');
  });

  it('ignores reads and falls back to the role without writes', () => {
    expect(inferActionTarget(`composio_execute("GITHUB_LIST_PULL_REQUESTS", {})`, 'PR Reader')).toBe('github');
    expect(inferActionTarget(`print(1)`, 'Summariser')).toBe('summariser');
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

describe('approvalPreview', () => {
  it("shows a step's own fields, not the data it passed through", () => {
    const input = { reports: { pnl: { total: 1 } }, org: 'Co&Cu' };
    const out = JSON.stringify({ ...input, drive_link: 'https://drive/x', sheets: { 'Profit & Loss': 12 } });
    const shown = approvalPreview(out, [], JSON.stringify(input));
    expect(shown).toContain('drive_link');
    expect(shown).not.toContain('reports');
  });

  it('shows the whole output when every field was passed through', () => {
    const input = { a: 1 };
    expect(approvalPreview(JSON.stringify(input), [], input)).toBe('{"a":1}');
  });

  it('shows the written text, not the JSON wrapper', () => {
    const out = JSON.stringify({ doc_id: 'dry-run-preview', content_preview: 'Q: Can I pay COD?\nA: Only under ₹2,000.' });
    expect(approvalPreview(out)).toBe('Q: Can I pay COD?\nA: Only under ₹2,000.');
    expect(approvalPreview({ content: 'Hello team' })).toBe('Hello team');
  });

  it('keeps long documents far beyond the old 3000-character cut', () => {
    expect(approvalPreview(JSON.stringify({ content: 'x'.repeat(9000) }))).toHaveLength(9000);
  });

  it('falls back to the output when no text is reported', () => {
    expect(approvalPreview('{"rows": 5}')).toBe('{"rows": 5}');
    expect(approvalPreview('not json')).toBe('not json');
  });
});

describe('approvalPreview for messages', () => {
  it('leads with the recipient and subject of an email', () => {
    const out = JSON.stringify({ content: 'Template text from the previous agent', recipient: 'niranjan+test@gmail.com', subject: 'Template ready', message_id: 'dry-run-preview' });
    expect(approvalPreview(out)).toBe('To: niranjan+test@gmail.com\nSubject: Template ready\n\nTemplate text from the previous agent');
  });

  it('prefers the message body over passed-through content', () => {
    expect(approvalPreview({ to: 'a@b.co', body: 'Hi team', content: 'doc' })).toBe('To: a@b.co\n\nHi team');
  });

  it('shows the Slack channel', () => {
    expect(approvalPreview({ channel: '#growth', message: 'Weekly digest' })).toBe('Channel: #growth\n\nWeekly digest');
  });
});

describe('approvalPreview message field names', () => {
  it('finds a Slack message reported as message_preview', () => {
    expect(approvalPreview({ channel: '#test', message_preview: 'Audit: 0 packages' })).toBe('Channel: #test\n\nAudit: 0 packages');
  });
});

describe('approvalPreview with freely named content fields', () => {
  it('shows the longest content-like field', () => {
    const notes = '# Kick-off notes\n' + 'Decision: 70/30 split. '.repeat(20);
    expect(approvalPreview({ doc_id: 'dry-run-preview', notes_content: notes, status: 'created' })).toBe(notes);
  });

  it('ignores short or unrelated strings', () => {
    const out = { doc_url: 'https://docs.google.com/document/d/x', status: 'created' };
    expect(approvalPreview(out)).toBe(JSON.stringify(out, null, 2));
  });
});

describe('isComposioRead — write words used as nouns', () => {
  it.each(['NOTION_FETCH_ALL_BLOCK_CONTENTS', 'NOTION_FETCH_BLOCK_CONTENTS', 'GITHUB_GET_A_WORKFLOW_RUN', 'NOTION_BLOCK_CHILDREN_LIST'])(
    '%s is a read', (slug) => { expect(classifyAgentActions(`composio_execute("${slug}", {})`).hasWriteOps).toBe(false); });

  it.each(['GITHUB_BLOCK_A_USER', 'NOTION_APPEND_BLOCK_CHILDREN', 'NOTION_DELETE_BLOCK', 'GITHUB_GET_OR_CREATE_LABEL', 'GITHUB_RERUN_A_WORKFLOW'])(
    '%s still needs approval', (slug) => { expect(classifyAgentActions(`composio_execute("${slug}", {})`).hasWriteOps).toBe(true); });
});

describe('approval card shows the deferred calls themselves', () => {
  const stderr = [
    '[DRY_RUN] Skipped composio_execute(GOOGLEDRIVE_CREATE_PERMISSION) — write op deferred',
    '__AF_DEFERRED__:{"action": "GOOGLEDRIVE_CREATE_PERMISSION", "params": {"file_id": "1AbC", "type": "anyone", "role": "reader"}}',
    'some other log line',
    '__AF_DEFERRED__:{"action": "GMAIL_SEND_EMAIL", "params": {"recipient_email": "niranjan+test@gmail.com", "subject": "Digest", "body": "' + 'x'.repeat(160) + '..."}}',
    '__AF_DEFERRED__:{"action": "TRUNC',
  ].join('\n');

  it('parses complete lines and skips truncated ones', () => {
    const writes = parseDeferredWrites(stderr);
    expect(writes.map(w => w.action)).toEqual(['GOOGLEDRIVE_CREATE_PERMISSION', 'GMAIL_SEND_EMAIL']);
  });

  it('puts who/where/access above the content, then the full text the call will send', () => {
    const preview = approvalPreview('{"content":"' + 'Proposal text '.repeat(20) + '"}', parseDeferredWrites(stderr));
    expect(preview.startsWith('Will run:')).toBe(true);
    expect(preview).toContain('GOOGLEDRIVE_CREATE_PERMISSION — file_id: 1AbC, type: anyone, role: reader');
    expect(preview.split('\n').find(l => l.startsWith('• GMAIL_SEND_EMAIL'))).toBe('• GMAIL_SEND_EMAIL — recipient_email: niranjan+test@gmail.com, subject: Digest');
    expect(preview).toContain('x'.repeat(160));
    expect(preview).not.toContain('Proposal text');
  });

  it("falls back to the agent's output when no call carries long text", () => {
    const writes = parseDeferredWrites('__AF_DEFERRED__:{"action": "SLACK_SEND_MESSAGE", "params": {"channel": "#c", "text": "short"}}');
    expect(approvalPreview('{"content":"' + 'Report '.repeat(40) + '"}', writes)).toContain('Report Report');
  });

  it('stores calls with long text shortened', () => {
    const [w] = compactWrites([{ action: 'GMAIL_SEND_EMAIL', params: { body: 'y'.repeat(1000), subject: 's' } }]);
    expect((w.params as any).body).toHaveLength(301);
    expect((w.params as any).subject).toBe('s');
  });

  it('is unchanged when nothing was deferred', () => {
    expect(approvalPreview('{"content":"hello"}', [])).toBe(approvalPreview('{"content":"hello"}'));
  });
});

describe('composio_proxy calls', () => {
  it('reads are reads; writes need review; deletes and sends are irreversible', () => {
    expect(classifyAgentActions(`composio_proxy("zoho_books", "GET", "/reports/profitandloss", params={})`)).toEqual({ hasWriteOps: false, writeRisk: 'read' });
    expect(classifyAgentActions(`composio_proxy("zoho_books", "POST", "/invoices", body=inv)`).writeRisk).toBe('write_reversible');
    expect(classifyAgentActions(`composio_proxy("zoho_books", "POST", f"/invoices/{iid}/email", body={})`).writeRisk).toBe('write_irreversible');
    expect(classifyAgentActions(`composio_proxy("zoho_books", "DELETE", f"/invoices/{iid}")`).writeRisk).toBe('write_irreversible');
    expect(classifyAgentActions(`composio_proxy(tk, method, path)`).writeRisk).toBe('write_reversible');
    expect(classifyAgentActions(`composio_proxy('zoho_books', 'POST', f'/invoices?organization_id={org_id}&send=false', body=b)`).writeRisk).toBe('write_reversible');
  });

  it('lists proxy writes for the approval card', () => {
    expect(proxyWriteLabels(`composio_proxy("zoho_books", "GET", "/reports/x")\ncomposio_proxy('zoho_books', 'post', '/bills', body=b)`)).toEqual(['ZOHO_BOOKS POST /bills']);
  });
});

describe('bulk writes on the approval card', () => {
  const deletes = Array.from({ length: 35 }, (_, i) => ({ action: 'ZOHO_BOOKS_DELETE_EXPENSE', params: { expense_id: `e${i}` } }));
  const sends = Array.from({ length: 5 }, (_, i) => ({ action: 'ZOHO_BOOKS_MARK_INVOICE_AS_SENT', params: { invoice_id: `i${i}` } }));

  it('keeps every deferred write, not the first 20', () => {
    const stderr = [...deletes, ...sends].map(w => `__AF_DEFERRED__:${JSON.stringify(w)}`).join('\n');
    expect(parseDeferredWrites(stderr)).toHaveLength(40);
  });

  it('counts each kind of call and shows examples of every kind', () => {
    const card = describeDeferredWrites([...deletes, ...sends]);
    expect(card).toContain('Will run 40 calls: ZOHO_BOOKS_DELETE_EXPENSE ×35, ZOHO_BOOKS_MARK_INVOICE_AS_SENT ×5');
    expect(card).toContain('invoice_id: i0');
    expect(card).toContain('…and 32 more');
  });
});
