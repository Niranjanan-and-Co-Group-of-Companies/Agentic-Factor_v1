import { describe, it, expect } from 'vitest';
import { toolkitsOf, isApiError } from '../toolkit-lessons';

describe('toolkitsOf', () => {
  it('names the toolkits a script proxies to, lower-cased and de-duplicated', async () => {
    const code = `composio_proxy("zoho_books", "GET", "/books/v3/invoices")\ncomposio_proxy('ZOHO_BOOKS', 'POST', '/books/v3/bills')\ncomposio_proxy("googledrive", "POST", "https://x")`;
    expect(await toolkitsOf(code)).toEqual(['zoho_books', 'googledrive']);
  });

  it('returns nothing for a script with no app calls', async () => {
    expect(await toolkitsOf('print(1)')).toEqual([]);
  });
});

describe('isApiError', () => {
  it('learns from API and schema errors', () => {
    expect(isApiError('ZOHO_BOOKS POST /books/v3/vendorpayments: HTTP 400: Invalid value passed for JSONString')).toBe(true);
    expect(isApiError(`These writes don't match the app's API:\nZOHO_BOOKS_CREATE_CHART_OF_ACCOUNT: account_type="x" is not allowed`)).toBe(true);
  });
  it('never learns from a failed review, even inside a time-out message', () => {
    expect(isApiError('Output failed critic review. Reason: March bills are not paid, contradicting the required payments')).toBe(false);
    expect(isApiError('Agent "Q2" ran out of time after 3 attempt(s). Output failed critic review. Reason: invalid totals')).toBe(false);
  });
});
