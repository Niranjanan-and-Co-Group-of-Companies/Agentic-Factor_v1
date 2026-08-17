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

      case 'calendly': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'Personal Access Token is required' };
        const res = await fetch('https://api.calendly.com/users/me', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Calendly token' };
        const data = await res.json();
        const name = data.resource?.name || 'verified';
        return { verified: true, accountInfo: `Account: ${name}` };
      }

      case 'typeform': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'Personal Access Token is required' };
        const res = await fetch('https://api.typeform.com/me', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Typeform token' };
        const data = await res.json();
        return { verified: true, accountInfo: `Account: ${data.email || data.alias || 'verified'}` };
      }

      case 'apollo': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'API key is required' };
        // Use a minimal people search (1 result) to verify the key
        const res = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ per_page: 1 }),
        });
        if (res.status === 401 || res.status === 403) return { verified: false, error: 'Invalid Apollo.io API key' };
        if (!res.ok) return { verified: false, error: `Apollo.io returned HTTP ${res.status}` };
        const data = await res.json();
        const credits = data.partial_results_limit ?? null;
        return { verified: true, accountInfo: credits ? `Connected · ${credits} credits/month` : 'Apollo.io key verified' };
      }

      case 'slack': {
        const token = fields.apiKey || fields.token;
        if (!token) return { verified: false, error: 'Bot token is required' };
        const res = await fetch('https://slack.com/api/auth.test', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!data.ok) return { verified: false, error: data.error || 'Invalid Slack token' };
        return { verified: true, accountInfo: `Workspace: ${data.team} (${data.user})` };
      }

      case 'github': {
        const token = fields.apiKey || fields.token;
        if (!token) return { verified: false, error: 'Personal Access Token is required' };
        const res = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
        });
        if (!res.ok) return { verified: false, error: 'Invalid GitHub token' };
        const data = await res.json();
        return { verified: true, accountInfo: `Account: ${data.login} (${data.name || 'GitHub'})` };
      }

      case 'hubspot': {
        const token = fields.apiKey || fields.token;
        if (!token) return { verified: false, error: 'Private App Token is required' };
        const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid HubSpot token' };
        return { verified: true, accountInfo: 'HubSpot connected' };
      }

      case 'notion': {
        const token = fields.apiKey || fields.token;
        if (!token) return { verified: false, error: 'Integration token is required' };
        const res = await fetch('https://api.notion.com/v1/users/me', {
          headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Notion token' };
        const data = await res.json();
        return { verified: true, accountInfo: `Account: ${data.name || data.id}` };
      }

      case 'airtable': {
        const token = fields.apiKey || fields.token;
        if (!token) return { verified: false, error: 'Personal Access Token is required' };
        const res = await fetch('https://api.airtable.com/v0/meta/whoami', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Airtable token' };
        const data = await res.json();
        return { verified: true, accountInfo: `Account ID: ${data.id}` };
      }

      case 'discord': {
        const token = fields.apiKey || fields.token;
        if (!token) return { verified: false, error: 'Bot token is required' };
        const res = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${token}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Discord bot token' };
        const data = await res.json();
        return { verified: true, accountInfo: `Bot: ${data.username}#${data.discriminator}` };
      }

      case 'twitter': {
        const token = fields.apiKey || fields.bearerToken;
        if (!token) return { verified: false, error: 'Bearer token is required' };
        const res = await fetch('https://api.twitter.com/2/users/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Twitter/X bearer token' };
        const data = await res.json();
        return { verified: true, accountInfo: `Account: @${data.data?.username}` };
      }

      case 'zoho': {
        const token = fields.apiKey || fields.accessToken;
        if (!token) return { verified: false, error: 'Access token is required' };
        const domain = fields.domain || 'crm.zoho.com';
        const res = await fetch(`https://${domain}/crm/v3/users?type=CurrentUser`, {
          headers: { Authorization: `Zoho-oauthtoken ${token}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Zoho token' };
        const data = await res.json();
        const user = (data.users as Record<string, string>[])?.[0];
        return { verified: true, accountInfo: `Account: ${user?.full_name || user?.email || 'verified'}` };
      }

      case 'salesforce': {
        const { accessToken, instanceUrl } = fields;
        if (!accessToken || !instanceUrl) return { verified: false, error: 'Access token and instance URL are required' };
        const res = await fetch(`${instanceUrl}/services/data/v59.0/limits`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Salesforce credentials' };
        return { verified: true, accountInfo: `Instance: ${instanceUrl}` };
      }

      case 'vapi': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'API key is required' };
        const res = await fetch('https://api.vapi.ai/assistant?limit=1', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Vapi API key' };
        return { verified: true, accountInfo: 'Vapi connected' };
      }

      case 'elevenlabs': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'API key is required' };
        const res = await fetch('https://api.elevenlabs.io/v1/user', {
          headers: { 'xi-api-key': apiKey },
        });
        if (!res.ok) return { verified: false, error: 'Invalid ElevenLabs API key' };
        const data = await res.json() as { subscription?: { tier?: string } };
        return { verified: true, accountInfo: `Plan: ${data.subscription?.tier ?? 'free'}` };
      }

      case 'deepgram': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'API key is required' };
        const res = await fetch('https://api.deepgram.com/v1/projects', {
          headers: { Authorization: `Token ${apiKey}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Deepgram API key' };
        const data = await res.json() as { projects?: Array<{ name: string }> };
        return { verified: true, accountInfo: `Project: ${data.projects?.[0]?.name ?? 'verified'}` };
      }

      case 'linear': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'API key is required' };
        const res = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ viewer { name email } }' }),
        });
        if (!res.ok) return { verified: false, error: 'Invalid Linear API key' };
        const data = await res.json() as { data?: { viewer?: { name?: string; email?: string } } };
        return { verified: true, accountInfo: `Account: ${data.data?.viewer?.name ?? data.data?.viewer?.email ?? 'verified'}` };
      }

      case 'zendesk': {
        const { email, token, subdomain } = fields;
        if (!email || !token || !subdomain) return { verified: false, error: 'Email, token and subdomain are required' };
        const credentials = Buffer.from(`${email}/token:${token}`).toString('base64');
        const res = await fetch(`https://${subdomain}.zendesk.com/api/v2/users/me.json`, {
          headers: { Authorization: `Basic ${credentials}` },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Zendesk credentials' };
        const data = await res.json() as { user?: { name?: string } };
        return { verified: true, accountInfo: `Agent: ${data.user?.name ?? 'verified'}` };
      }

      case 'shopify': {
        const { apiKey, shop } = fields;
        if (!apiKey || !shop) return { verified: false, error: 'Access token and shop domain are required' };
        const res = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
          headers: { 'X-Shopify-Access-Token': apiKey },
        });
        if (!res.ok) return { verified: false, error: 'Invalid Shopify credentials' };
        const data = await res.json() as { shop?: { name?: string } };
        return { verified: true, accountInfo: `Store: ${data.shop?.name ?? shop}` };
      }

      case 'buffer': {
        const apiKey = fields.apiKey;
        if (!apiKey) return { verified: false, error: 'Access token is required' };
        // Buffer's new API is GraphQL at api.buffer.com
        const res = await fetch('https://api.buffer.com', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ account { organizations { id name } } }' }),
        });
        if (!res.ok) return { verified: false, error: 'Invalid Buffer access token — get one at publish.buffer.com/settings/api' };
        const data = await res.json() as { data?: { account?: { organizations?: Array<{ id: string; name: string }> } }; errors?: unknown[] };
        if (data.errors?.length) return { verified: false, error: 'Invalid Buffer access token — get one at publish.buffer.com/settings/api' };
        const orgs = data.data?.account?.organizations ?? [];
        const orgName = orgs[0]?.name || 'Buffer';
        const channelWord = orgs.length > 1 ? `${orgs.length} organizations` : orgName;
        return { verified: true, accountInfo: `Connected: ${channelWord}` };
      }

      default:
        // For providers without a verify endpoint, skip verification and trust the user
        return { verified: true, accountInfo: 'Credentials saved (not verified)' };
    }
  } catch (err) {
    return { verified: false, error: `Network error: ${(err as Error).message}` };
  }
}
