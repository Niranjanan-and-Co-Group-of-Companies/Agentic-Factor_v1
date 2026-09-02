/**
 * Strips internal tool/vendor names from customer-facing mission titles.
 * These names must never be visible to customers.
 */
export function sanitizeTitle(title: string): string {
  return title
    .replace(/\s*(via|using|with|powered by)\s+(Composio|E2B|Supabase|Inngest)\b/gi, '')
    .replace(/\b(Composio|E2B|Supabase|Inngest)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
