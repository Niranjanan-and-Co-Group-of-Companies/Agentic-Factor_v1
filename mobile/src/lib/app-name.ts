// Display names for connected apps: "googlesheets" → "Google Sheets", "zoho_books" → "Zoho Books".
// (The website's src/lib/utils/app-name.ts — the app imports only types from the website.)

export function appName(slug: string): string {
  const lower = slug.toLowerCase();
  const google = /^google([a-z]+)$/.exec(lower);
  const words = (google ? `google ${google[1]}` : lower.replace(/[_-]+/g, ' ')).split(' ').filter(Boolean);
  return words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}
