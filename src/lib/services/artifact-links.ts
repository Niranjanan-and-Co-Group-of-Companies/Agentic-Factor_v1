/**
 * Files agents create (workbooks, decks, charts) live in a private bucket. Their links point at the
 * app, which opens a file only for a signed-in member of the workspace that owns it, through a signed
 * storage URL that expires within minutes. They used to be public storage URLs: anyone holding a link
 * could open a customer's financial workbook.
 */
export const ARTIFACT_BUCKET = 'mission-artifacts';
export const ARTIFACT_LINK_TTL_SECONDS = 300;

const APP_PATH = '/api/artifacts/file';

/** The app link for a stored artifact (absolute, so it also works inside emails and documents). */
export function artifactLink(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://agenticfactor.io').replace(/\/$/, '');
  return `${base}${APP_PATH}?path=${encodeURIComponent(path)}`;
}

/** The storage path behind an artifact URL: an app link, or a public/signed storage URL saved before files were private. */
export function artifactPath(url: string): string | null {
  try {
    const u = new URL(url, 'https://agenticfactor.io');
    if (u.pathname === APP_PATH) return u.searchParams.get('path');
    const m = new RegExp(`/storage/v1/object/(?:public|sign)/${ARTIFACT_BUCKET}/(.+)$`).exec(u.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/** Same-origin link for the dashboard (keeps the session cookie); `download` asks for an attachment. */
export function artifactHref(url: string, download = false): string {
  const path = artifactPath(url);
  if (!path) return url;
  return `${APP_PATH}?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`;
}

/** Whether a workspace may open this path: its own folder, no path tricks. */
export function artifactBelongsTo(path: string, tenantId: string): boolean {
  return path.startsWith(`${tenantId}/`) && !path.split('/').some(seg => seg === '..' || seg === '.' || seg === '');
}
