// Display names for Composio toolkit slugs and action slugs, without a per-app lookup table.

/** "googlesheets" → "Google Sheets", "zoho_books" → "Zoho Books", "gmail" → "Gmail". */
export function appName(slug: string): string {
  const lower = slug.toLowerCase();
  const google = /^google([a-z]+)$/.exec(lower);
  const words = (google ? `google ${google[1]}` : lower.replace(/[_-]+/g, ' ')).split(' ').filter(Boolean);
  return words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/**
 * "GMAIL_SEND_EMAIL" → "Gmail: send email"; "GOOGLESHEETS_CREATE_GOOGLE_SHEET1" → "Google Sheets: create google sheet".
 * Known toolkit slugs (longest first) decide where the app ends; otherwise the first word is the app.
 */
export function humanizeAction(slug: string, toolkits: string[] = []): string {
  const upper = slug.toUpperCase();
  const kit = [...toolkits].sort((a, b) => b.length - a.length).find(t => upper.startsWith(`${t.toUpperCase()}_`));
  const app = kit ?? upper.split('_')[0].toLowerCase();
  const rest = upper.slice(app.length + 1);
  const verb = rest.toLowerCase().split('_').filter(Boolean).map(w => w.replace(/(?<=[a-z])\d+$/, '')).join(' ').trim();
  return verb ? `${appName(app)}: ${verb}` : appName(app);
}
