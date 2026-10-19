// The ticket that carries a connection through the app's own OAuth page and back to our callback.
// It names the account, the app being connected and where to return, signed and valid for an hour, so
// the callback can no longer be called with any account id to mark an app "connected" on it.

import { createHmac, timingSafeEqual } from 'crypto';

import { appReturnUrl } from '@/lib/utils/app-return';

const TTL_MS = 60 * 60_000;

export interface ConnectState { tenantId: string; provider: string; returnTo?: string }

function key(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  // Derived for this purpose only, so a ticket is useless anywhere else.
  return `${secret}:composio-callback-v1`;
}

const sign = (body: string) => createHmac('sha256', key()).update(body).digest('base64url');

export function signConnectState(state: ConnectState, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ t: state.tenantId, p: state.provider, r: appReturnUrl(state.returnTo) ?? undefined, e: now + TTL_MS })).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** The ticket's contents when it is ours, unaltered and unexpired; otherwise null. */
export function readConnectState(ticket: string | null | undefined, now = Date.now()): ConnectState | null {
  if (!ticket) return null;
  const [body, sig] = ticket.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString()) as { t?: unknown; p?: unknown; r?: unknown; e?: unknown };
    if (typeof d.t !== 'string' || typeof d.p !== 'string' || typeof d.e !== 'number' || d.e < now) return null;
    return { tenantId: d.t, provider: d.p, returnTo: appReturnUrl(d.r) ?? undefined };
  } catch {
    return null;
  }
}

/** The callback address Composio sends the customer back to after they grant access. */
export function connectCallbackUrl(appUrl: string, state: ConnectState): string {
  return `${appUrl}/api/composio/callback?state=${encodeURIComponent(signConnectState(state))}`;
}
