import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';

export const maxDuration = 15;

// POST /api/connectors/apikey/verify
// Tests a customer-provided API key against the real service before saving.
// Returns { verified: true } or { verified: false, error: string }
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;

  try {
    const { provider, fields } = await request.json() as {
      provider: string;
      fields: Record<string, string>;
    };

    if (!provider || !fields) {
      return NextResponse.json({ verified: false, error: 'provider and fields are required' }, { status: 400 });
    }

    const result = await verifyApiKey(provider, fields);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST /api/connectors/apikey/verify]', err);
    return NextResponse.json({ verified: false, error: 'Verification request failed' }, { status: 500 });
  }
}

async function verifyApiKey(
  provider: string,
  fields: Record<string, string>
): Promise<{ verified: boolean; error?: string; accountInfo?: string }> {
  try {
    switch (provider) {
      case 'hunter': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'API key is required' };
        const res = await fetch(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(apiKey)}`);
        const data = await res.json();
        if (!res.ok || data.errors?.length) {
          return { verified: false, error: data.errors?.[0]?.details || 'Invalid API key' };
        }
        const plan = data.data?.plan_name || 'Free';
        const requests = data.data?.requests?.searches?.available ?? '?';
        return { verified: true, accountInfo: `Plan: ${plan} · ${requests} searches available` };
      }

      case 'sendgrid': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'API key is required' };
        const res = await fetch('https://api.sendgrid.com/v3/user/profile', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid SendGrid API key' };
        const data = await res.json();
        return { verified: true, accountInfo: `Account: ${data.email || data.username || 'verified'}` };
      }

      case 'stripe': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'API key is required' };
        const res = await fetch('https://api.stripe.com/v1/account', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Stripe key' };
        const data = await res.json();
        return { verified: true, accountInfo: `Account: ${data.email || data.business_profile?.name || 'verified'}` };
      }

      case 'replicate': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'API key is required' };
        const res = await fetch('https://api.replicate.com/v1/account', {
          headers: { Authorization: `Token ${apiKey}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Replicate API token' };
        const data = await res.json();
        return { verified: true, accountInfo: `Account: ${data.username || 'verified'}` };
      }

      case 'openai_api': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'API key is required' };
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid OpenAI API key' };
        return { verified: true, accountInfo: 'OpenAI API key verified' };
      }

      case 'twilio': {
        const { accountSid, authToken } = fields;
        if (!accountSid || !authToken) return { verified: false, error: 'Account SID and Auth Token are required' };
        const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
          headers: { Authorization: `Basic ${credentials}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Twilio credentials' };
        const data = await res.json();
        return { verified: true, accountInfo: `Account: ${data.friendly_name || accountSid}` };
      }

      default:
        // For providers without a verify endpoint, skip verification and trust the user
        return { verified: true, accountInfo: 'Credentials saved (not verified)' };
    }
  } catch (err) {
    return { verified: false, error: `Network error: ${(err as Error).message}` };
  }
}
