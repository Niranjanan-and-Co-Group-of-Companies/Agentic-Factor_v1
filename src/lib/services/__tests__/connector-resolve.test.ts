import { describe, it, expect, vi } from 'vitest';
import { resolveConnectorApp } from '../connector-resolve';

// Composio's catalog search, as it answers for a few names
const catalog: Record<string, Array<{ slug: string; name: string }>> = {
  'zoho books': [{ slug: 'zoho_books', name: 'Zoho Books' }, { slug: 'zoho', name: 'Zoho' }],
  hubspot: [{ slug: 'hubspot', name: 'HubSpot' }],
  jira: [{ slug: 'jira', name: 'Jira' }, { slug: 'confluence', name: 'Confluence' }],
  notion: [{ slug: 'notion', name: 'Notion' }],
};
const search = vi.fn(async (q: string) => catalog[q.toLowerCase()] ?? []);

describe('which app a connect suggestion means', () => {
  it('keeps Google apps apart — Sheets is not Drive, Docs or Gmail', async () => {
    expect(await resolveConnectorApp('Google Sheets', search)).toEqual({ slug: 'googlesheets', name: 'Google Sheets' });
    expect(await resolveConnectorApp('googledrive', search)).toEqual({ slug: 'googledrive', name: 'Google Drive' });
    expect(await resolveConnectorApp('Google Docs', search)).toEqual({ slug: 'googledocs', name: 'Google Docs' });
    expect(await resolveConnectorApp('gmail', search)).toEqual({ slug: 'gmail', name: 'Gmail' });
    expect(await resolveConnectorApp('YouTube', search)).toEqual({ slug: 'youtube', name: 'Youtube' });
  });

  it('asks instead of guessing when a name covers several apps', async () => {
    for (const vague of ['google', 'Google Workspace', 'Microsoft', 'Zoho', 'sheets', 'drive']) {
      expect(await resolveConnectorApp(vague, search)).toBeNull();
    }
  });

  it('finds other apps by exact name in the catalog, never a near miss', async () => {
    expect(await resolveConnectorApp('Zoho Books', search)).toEqual({ slug: 'zoho_books', name: 'Zoho Books' });
    expect(await resolveConnectorApp('Zoho CRM', search)).toEqual({ slug: 'zoho', name: 'Zoho' });
    expect(await resolveConnectorApp('HubSpot', search)).toEqual({ slug: 'hubspot', name: 'Hubspot' });
    expect(await resolveConnectorApp('jira', search)).toEqual({ slug: 'jira', name: 'Jira' });
    expect(await resolveConnectorApp('Some App Nobody Has', search)).toBeNull();
  });
});
