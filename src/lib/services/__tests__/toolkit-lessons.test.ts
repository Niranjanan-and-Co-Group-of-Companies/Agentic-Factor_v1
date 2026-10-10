import { describe, it, expect } from 'vitest';
import { toolkitsOf } from '../toolkit-lessons';

describe('toolkitsOf', () => {
  it('names the toolkits a script proxies to, lower-cased and de-duplicated', async () => {
    const code = `composio_proxy("zoho_books", "GET", "/books/v3/invoices")\ncomposio_proxy('ZOHO_BOOKS', 'POST', '/books/v3/bills')\ncomposio_proxy("googledrive", "POST", "https://x")`;
    expect(await toolkitsOf(code)).toEqual(['zoho_books', 'googledrive']);
  });

  it('returns nothing for a script with no app calls', async () => {
    expect(await toolkitsOf('print(1)')).toEqual([]);
  });
});
