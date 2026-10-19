/**
 * Where an in-app browser flow (connecting an app) sends the customer back to: only the mobile app's own
 * address (agenticfactor://…) or, while developing, Expo Go's (exp://…). Anything else is dropped, so
 * the parameter can't be used to bounce people to another site.
 */
export function appReturnUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  return /^(agenticfactor|exp|exps):\/\/[^\s"'<>]*$/i.test(value) ? value : null;
}

/** The return address with the outcome added (?status=connected&provider=gmail). */
export function withOutcome(returnTo: string, outcome: Record<string, string>): string {
  const query = new URLSearchParams(outcome).toString();
  return `${returnTo}${returnTo.includes('?') ? '&' : '?'}${query}`;
}
