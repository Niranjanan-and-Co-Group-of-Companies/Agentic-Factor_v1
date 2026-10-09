import { describe, it, expect } from 'vitest';
import { pickToolkit } from '../composio-actions';
import { declareCalledToolkits, permissionCovers, toolkitNotice } from '../toolkit-resolver';

describe('pickToolkit', () => {
  const zoho = [{ slug: 'zoho', name: 'Zoho CRM' }, { slug: 'zoho_books', name: 'Zoho Books' }, { slug: 'zoho_invoice', name: 'Zoho Invoice' }];
  it('matches the exact product, never a sibling', () => {
    expect(pickToolkit('Zoho Books', zoho)).toBe('zoho_books');
    expect(pickToolkit('zoho books', zoho)).toBe('zoho_books');
    expect(pickToolkit('Zoho', zoho)).toBe('zoho');
    expect(pickToolkit('Google Sheets', [{ slug: 'googlesheets', name: 'Googlesheets' }])).toBe('googlesheets');
    expect(pickToolkit('Zoho Analytics', zoho)).toBeUndefined();
  });
});

describe('toolkitNotice', () => {
  it('says which toolkits are connected and how to declare the rest', () => {
    const notice = toolkitNotice([
      { name: 'Zoho Books', slug: 'zoho_books' }, { name: 'Gmail', slug: 'gmail' }, { name: 'Tally', slug: undefined },
    ], ['gmail']);
    expect(notice).toContain('"Zoho Books" → zoho_books — NOT connected yet');
    expect(notice).toContain('"service": "zoho_books"');
    expect(notice).toContain('"Gmail" → gmail (connected)');
    expect(notice).toContain('"Tally" → no Composio toolkit');
    expect(toolkitNotice([], ['gmail'])).toBe('');
  });
});

describe('declareCalledToolkits', () => {
  const lookup = async (a: string) => (a.startsWith('ZOHO_BOOKS_') ? 'zoho_books' : a.startsWith('GMAIL_') ? 'gmail' : a.startsWith('GOOGLESHEETS_') ? 'googlesheets' : null);
  const perm = (service: string, type = 'composio_oauth') => ({ type, service, scope: 'x', confidentialityLevel: 'internal', granted: false });

  it('adds the toolkit an action belongs to when no permission covers it', async () => {
    const out = await declareCalledToolkits(
      [`r = composio_execute("ZOHO_BOOKS_GET_PROFIT_AND_LOSS", {})\ncomposio_execute('ZOHO_BOOKS_LIST_ACCOUNTS', {})`, `composio_execute("GMAIL_SEND_EMAIL", {})`],
      [perm('zoho'), perm('gmail')], ['zoho_books'], lookup,
    );
    expect(out.map(p => p.service)).toEqual(['zoho', 'gmail', 'zoho_books']);
    expect(out[2]).toMatchObject({ type: 'composio_oauth', scope: 'ZOHO_BOOKS_GET_PROFIT_AND_LOSS,ZOHO_BOOKS_LIST_ACCOUNTS', granted: true });
  });

  it('treats the legacy google permission as covering every Google toolkit', async () => {
    const out = await declareCalledToolkits([`composio_execute("GOOGLESHEETS_BATCH_UPDATE", {})`], [perm('google', 'oauth_token')], [], lookup);
    expect(out).toHaveLength(1);
    expect(permissionCovers('google', 'googlesheets')).toBe(true);
    expect(permissionCovers('zoho', 'zoho_books')).toBe(false);
  });
});

import { matchesAlias } from '../oauth-refresher';

describe('matchesAlias', () => {
  it('matches whole words only', () => {
    expect(matchesAlias('xero', 'x')).toBe(false);
    expect(matchesAlias('twitter/x', 'x')).toBe(true);
    expect(matchesAlias('google sheets', 'google')).toBe(true);
    expect(matchesAlias('monday.com', 'monday.com')).toBe(true);
    expect(matchesAlias('zoho books', 'zoho')).toBe(true);
    expect(matchesAlias('zoho_books', 'zoho')).toBe(false);
  });
});
