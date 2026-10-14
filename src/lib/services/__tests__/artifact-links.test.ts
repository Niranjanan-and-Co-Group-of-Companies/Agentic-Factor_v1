import { describe, it, expect } from 'vitest';
import { artifactBelongsTo, artifactHref, artifactLink, artifactPath } from '../artifact-links';

const T = 'a081fa4a-0791-4f75-a31f-1e8c07241db7';
const path = `${T}/m1/agent1/Financial Statements.xlsx`;

describe('artifact links', () => {
  it('links to the app, never to public storage', () => {
    const link = artifactLink(path);
    expect(link).toContain('/api/artifacts/file?path=');
    expect(link).not.toContain('/storage/v1/object/public');
    expect(artifactPath(link)).toBe(path);
  });

  it('rewrites public storage links saved before files were private', () => {
    const old = `https://x.supabase.co/storage/v1/object/public/mission-artifacts/${T}/m1/agent1/image_1.png`;
    expect(artifactHref(old)).toBe(`/api/artifacts/file?path=${encodeURIComponent(`${T}/m1/agent1/image_1.png`)}`);
    expect(artifactHref(old, true)).toContain('&download=1');
  });

  it('leaves other links alone', () => {
    expect(artifactHref('https://docs.google.com/spreadsheets/d/1')).toBe('https://docs.google.com/spreadsheets/d/1');
  });

  it('opens a file only for the workspace that owns it', () => {
    expect(artifactBelongsTo(path, T)).toBe(true);
    expect(artifactBelongsTo(path, 'another-tenant')).toBe(false);
    expect(artifactBelongsTo(`${T}/../other/file.pdf`, T)).toBe(false);
    expect(artifactBelongsTo(`${T}x/m1/file.pdf`, T)).toBe(false);
  });
});
