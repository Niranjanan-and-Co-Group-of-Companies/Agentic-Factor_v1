import { describe, it, expect } from 'vitest';
import { repairMissionPermissions } from '../intake';

const perm = (service: string, type = 'composio_oauth') =>
  ({ type, service, scope: 'x', confidentialityLevel: 'internal', granted: true });

describe('repairMissionPermissions', () => {
  it('does not add a fake "google" toolkit when googlesheets is already declared', () => {
    const out = repairMissionPermissions(
      [{ role: 'Sheet Builder', tools: [{ name: 'Google Sheets API', type: 'api' }] }],
      [perm('googlesheets')],
    );
    expect(out.map(p => p.service)).toEqual(['googlesheets']);
  });

  it('adds the specific Google app slug a tool needs', () => {
    const agents = [{ role: 'Ops', tools: [
      { name: 'Google Drive Upload', type: 'api' },
      { name: 'Google Docs Writer', type: 'api' },
      { name: 'Google Calendar', type: 'api' },
      { name: 'Gmail Sender', type: 'api' },
    ] }];
    expect(repairMissionPermissions(agents, []).map(p => p.service))
      .toEqual(['googledrive', 'googledocs', 'googlecalendar', 'gmail']);
  });

  it('uses the Composio slug for LinkedIn, not the legacy linkedin_oidc key', () => {
    const out = repairMissionPermissions([{ role: 'Poster', tools: [{ name: 'LinkedIn Post API', type: 'api' }] }], []);
    expect(out).toMatchObject([{ type: 'composio_oauth', service: 'linkedin' }]);
  });

  it('keeps API-key providers as api_key permissions', () => {
    const out = repairMissionPermissions([{ role: 'Artist', tools: [{ name: 'DALL-E Image Generator', type: 'api' }] }], []);
    expect(out).toMatchObject([{ type: 'api_key', service: 'openai' }]);
  });

  it('skips platform-internal tools', () => {
    const out = repairMissionPermissions([{ role: 'Researcher', tools: [{ name: 'Google Search', type: 'web_search' }] }], []);
    expect(out).toEqual([]);
  });
});
