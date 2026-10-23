/**
 * Where links back to the platform point (the end of connecting an app, sign-in links). A preview
 * deployment points to itself — a connection made while testing a preview comes back to that preview,
 * not to the live site running older code; everywhere else, the site.
 */
export function appBaseUrl(): string {
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}
