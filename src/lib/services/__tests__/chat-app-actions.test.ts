import { describe, it, expect } from 'vitest';
import { checkDo, grantFor, previewOf, toolkitOf, validatePlan, type AppActionPlan } from '../chat-app-actions';

const connected = ['gmail', 'googlesheets', 'zoho', 'zoho_books'];

describe('a one-time job in the chat', () => {
  it('knows which connected app an action belongs to', () => {
    expect(toolkitOf('ZOHO_BOOKS_LIST_INVOICES', connected)).toBe('zoho_books');
    expect(toolkitOf('ZOHO_GET_RECORDS', connected)).toBe('zoho');
    expect(toolkitOf('GOOGLESHEETS_CREATE_GOOGLE_SHEET1', connected)).toBe('googlesheets');
  });

  it('needs no OK for reading, and the exact content for sending', () => {
    expect(validatePlan({ summary: 'Look', steps: [{ action_slug: 'GMAIL_FETCH_EMAILS', what: 'Read the inbox' }] }, connected))
      .toEqual({ error: expect.stringContaining('only read') });
    expect(validatePlan({ summary: 'Email', steps: [{ action_slug: 'GMAIL_SEND_EMAIL', what: 'Email the team' }] }, connected))
      .toEqual({ error: expect.stringContaining('exact arguments') });
  });

  it('refuses apps that are not connected', () => {
    expect(validatePlan({ summary: 'Post', steps: [{ action_slug: 'SLACK_SEND_MESSAGE', what: 'Post it', arguments: { channel: 'x', text: 'y' } }] }, connected))
      .toEqual({ error: expect.stringContaining('isn\'t connected') });
  });

  it('turns a proposal into the card: creating may wait for earlier results, sending shows what goes out', () => {
    const out = validatePlan({
      summary: 'Make the sheet and email it',
      steps: [
        { action_slug: 'GOOGLESHEETS_CREATE_GOOGLE_SHEET1', what: 'Create the Overdue invoices sheet' },
        { action_slug: 'GMAIL_SEND_EMAIL', what: 'Email you the link', arguments: { recipient_email: 'me@x.com', subject: 'Overdue invoices', body: 'Here it is' } },
      ],
    }, connected);
    expect('plan' in out).toBe(true);
    const plan = (out as { plan: AppActionPlan }).plan;
    expect(plan.steps.map(s => [s.toolkit, s.exact])).toEqual([['googlesheets', false], ['gmail', true]]);
    expect(plan.steps[1].preview?.[0]).toEqual({ label: 'recipient email', value: 'me@x.com' });
  });
});

describe('carrying out an approved plan', () => {
  const plan: AppActionPlan = {
    summary: 'Sheet and email',
    steps: [
      { action: 'GOOGLESHEETS_CREATE_GOOGLE_SHEET1', toolkit: 'googlesheets', what: 'Create', exact: false },
      { action: 'GMAIL_SEND_EMAIL', toolkit: 'gmail', what: 'Email', exact: true, arguments: { recipient_email: 'me@x.com', subject: 'S', body: 'B' } },
    ],
  };

  it('reads any time, but changes nothing without an approval', () => {
    expect(checkDo(null, 'GMAIL_FETCH_EMAILS', { q: 'x' }, connected)).toEqual({ run: true, args: { q: 'x' } });
    expect(checkDo(null, 'GOOGLESHEETS_CREATE_GOOGLE_SHEET1', {}, connected).run).toBe(false);
  });

  it('sends exactly what was approved, once — whatever the assistant passes now', () => {
    const grant = grantFor(plan);
    expect(checkDo(grant, 'GMAIL_SEND_EMAIL', { recipient_email: 'attacker@evil.com', body: 'changed' }, connected))
      .toEqual({ run: true, args: { recipient_email: 'me@x.com', subject: 'S', body: 'B' } });
    expect(checkDo(grant, 'GMAIL_SEND_EMAIL', { recipient_email: 'me@x.com' }, connected).run).toBe(false);
  });

  it('lets creating and updating continue in the approved apps only', () => {
    const grant = grantFor(plan);
    expect(checkDo(grant, 'GOOGLESHEETS_BATCH_UPDATE', { values: [] }, connected).run).toBe(true);
    expect(checkDo(grant, 'ZOHO_BOOKS_CREATE_INVOICE', {}, connected).run).toBe(false);
    expect(checkDo(grant, 'GMAIL_DELETE_MESSAGE', { id: '1' }, connected).run).toBe(false);
  });
});

describe('the card preview', () => {
  it('shows recipients and content first, and shortens long values', () => {
    const preview = previewOf({ body: 'x'.repeat(700), zeta: 1, to: 'a@b.c', subject: 'Hi' });
    expect(preview.map(p => p.label)).toEqual(['to', 'subject', 'body', 'zeta']);
    expect(preview[2].value.length).toBe(601);
  });
});
