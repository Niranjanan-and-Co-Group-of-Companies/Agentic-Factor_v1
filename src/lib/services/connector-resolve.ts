// Which app a "connect this app" suggestion means — exactly one Composio toolkit, never a near miss.
// Google's apps are separate connections (Sheets is not Drive, Docs or Gmail), so a vague "google"
// resolves to nothing: the assistant asks which app instead of connecting the wrong one.

import { pickToolkit, searchComposioToolkits } from './composio-actions';
import { appName } from '../utils/app-name';

/** Apps by their product names and the short names customers use (never a bare "sheets" or "drive": Excel and OneDrive are sheets and drives too). */
const GOOGLE_APPS: Array<{ slug: string; names: string[] }> = [
  { slug: 'googlesheets',   names: ['google sheets', 'google sheet', 'gsheets', 'gsheet'] },
  { slug: 'googledrive',    names: ['google drive', 'gdrive'] },
  { slug: 'googledocs',     names: ['google docs', 'google doc', 'gdocs', 'gdoc'] },
  { slug: 'gmail',          names: ['gmail', 'google mail'] },
  { slug: 'googlecalendar', names: ['google calendar', 'gcal'] },
  { slug: 'googleslides',   names: ['google slides'] },
  { slug: 'googleforms',    names: ['google forms', 'google form'] },
  { slug: 'googlemeet',     names: ['google meet'] },
  { slug: 'googletasks',    names: ['google tasks'] },
  { slug: 'googlecontacts', names: ['google contacts'] },
  { slug: 'googlephotos',   names: ['google photos'] },
  { slug: 'youtube',        names: ['youtube', 'you tube'] },
  // Composio's Zoho CRM toolkit is plain "zoho" — so "Zoho CRM" is named here, and a bare "Zoho" is asked
  { slug: 'zoho',           names: ['zoho crm'] },
  { slug: 'zoho_books',     names: ['zoho books'] },
];

/** Names that cover several apps: which one is meant has to be asked. */
const AMBIGUOUS = new Set(['google', 'google workspace', 'g suite', 'gsuite', 'workspace', 'microsoft', 'office', 'microsoft 365', 'office 365', 'zoho', 'atlassian']);

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export interface ResolvedApp { slug: string; name: string }

/**
 * The one app a name means: a toolkit slug ("googlesheets"), a product name ("Google Sheets",
 * "Zoho Books") or a common short name ("gdrive"). Null when the name is vague or unknown.
 */
export async function resolveConnectorApp(
  name: string,
  search: typeof searchComposioToolkits = searchComposioToolkits,
): Promise<ResolvedApp | null> {
  const wanted = norm(name);
  if (!wanted || AMBIGUOUS.has(wanted)) return null;
  const compact = wanted.replace(/ /g, '');
  const google = GOOGLE_APPS.find(a => a.slug === compact || a.names.includes(wanted));
  if (google) return { slug: google.slug, name: appName(google.slug) };
  const slug = pickToolkit(name, await search(name)) ?? pickToolkit(compact, await search(compact));
  return slug ? { slug, name: appName(slug) } : null;
}
