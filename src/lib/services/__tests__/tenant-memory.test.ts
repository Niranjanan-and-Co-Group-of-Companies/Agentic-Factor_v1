import { describe, it, expect } from 'vitest';
import { isStorableFact, cleanTenantFacts, formatTenantMemory } from '../tenant-memory';

describe('isStorableFact', () => {
  // Real rows that were stored from one-off mission instructions and then blocked later missions.
  it.each([
    'No writing to Google Docs, no sending emails, no posting to Slack',
    'All data access is strictly read-only',
    'Prefers read-only operations with no external writes',
    'Output is delivered as plain-text summary in mission output with no external delivery',
    "Don't send or change any emails",
    'Agents must not modify the CRM',
    'Only read the calendar',
  ])('rejects task-scoped restriction: %s', (fact) => {
    expect(isStorableFact(fact)).toBe(false);
  });

  it.each([
    'Pipeline reports are sent to niranjan+test@gmail.com',
    'Support line is +91 98765 43210',
    'OpenAI API key is sk-abc123',
    'HubSpot password is hunter2',
  ])('rejects contact details and credentials: %s', (fact) => {
    expect(isStorableFact(fact)).toBe(false);
  });

  it.each([
    'NovaBrand is a D2C skincare brand based in India',
    "NovaBrand's target audience is urban women aged 25-40 in India",
    'NovaBrand sells a Vitamin C serum called NovaGlow 10% Vitamin C + Ferulic Serum priced at Rs 899',
    'GrowthPulse uses tools including Google Ads, Meta Business Manager, GA4, Slack, and Notion',
    "GrowthPulse's free Meta Ads audit involves a form, after which they send a personalised audit",
    'Never mention competitors by name',
    "Don't use emojis in Instagram posts",
  ])('keeps durable company facts and brand voice: %s', (fact) => {
    expect(isStorableFact(fact)).toBe(true);
  });

  it('rejects non-strings, empty and oversized facts', () => {
    expect(isStorableFact(undefined)).toBe(false);
    expect(isStorableFact({ fact: 'x' })).toBe(false);
    expect(isStorableFact('  ')).toBe(false);
    expect(isStorableFact('a'.repeat(301))).toBe(false);
  });
});

describe('cleanTenantFacts', () => {
  it('removes repeats that differ only in case and punctuation', () => {
    expect(cleanTenantFacts([
      'Techflow is a B2B project management SaaS company.',
      'techflow is a B2B project-management SaaS company',
      'Company name is Techflow',
    ])).toEqual(['Techflow is a B2B project management SaaS company.', 'Company name is Techflow']);
  });

  it('skips facts already stored', () => {
    expect(cleanTenantFacts(['Company name is NovaBrand', 'NovaBrand sells sunscreen'], ['company name is novabrand']))
      .toEqual(['NovaBrand sells sunscreen']);
  });

  it('filters out restrictions mixed in with real facts', () => {
    expect(cleanTenantFacts(['Company uses Slack', 'All data access is strictly read-only'])).toEqual(['Company uses Slack']);
  });
});

describe('formatTenantMemory', () => {
  it('is empty with no facts', () => {
    expect(formatTenantMemory([])).toBe('');
  });

  it('presents facts as background the current request overrides, not as policies', () => {
    const block = formatTenantMemory(['Company name is NovaBrand']);
    expect(block).toContain('- Company name is NovaBrand');
    expect(block).toContain('current request always takes precedence');
    expect(block).not.toMatch(/ALWAYS OBEY/i);
  });
});
