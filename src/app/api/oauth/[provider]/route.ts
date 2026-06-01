import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';
import { randomBytes, createHash } from 'crypto';

// ============================================================
// Dynamic OAuth Initiation Handler — supports ANY provider
// URL: /api/oauth/[provider]
//
// Creates the provider-specific OAuth authorization URL and
// redirects the user to it. The callback is handled by
// /api/oauth/callback/[provider].
// ============================================================

interface OAuthProviderConfig {
  authUrl: string;
  clientIdEnv: string;
  scopes: string[];
  scopeSeparator?: string;
  additionalParams?: Record<string, string>;
  // Some providers use a different key in the callback route
  callbackProviderKey?: string;
}

const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    scopes: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/contacts.readonly',
    ],
    additionalParams: { access_type: 'offline', prompt: 'consent' },
  },
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    scopes: ['openid', 'profile', 'email', 'w_member_social'],
    callbackProviderKey: 'linkedin_oidc',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    scopes: ['user', 'repo', 'read:org'],
  },
  slack: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    clientIdEnv: 'SLACK_CLIENT_ID',
    scopes: ['channels:read', 'channels:history', 'chat:write', 'users:read', 'users:read.email'],
    scopeSeparator: ',',
  },
  notion: {
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    clientIdEnv: 'NOTION_CLIENT_ID',
    scopes: [], // Notion handles scopes internally
    additionalParams: { owner: 'user' },
  },
  zoho: {
    authUrl: 'https://accounts.zoho.com/oauth/v2/auth',
    clientIdEnv: 'ZOHO_CLIENT_ID',
    scopes: ['ZohoCRM.modules.ALL', 'ZohoCRM.settings.ALL'],
    additionalParams: { access_type: 'offline', prompt: 'consent' },
  },
  discord: {
    authUrl: 'https://discord.com/api/oauth2/authorize',
    clientIdEnv: 'DISCORD_CLIENT_ID',
    scopes: ['identify', 'guilds', 'bot'],
  },
  // ── Social Media Connectors ──
  twitter: {
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    clientIdEnv: 'TWITTER_CLIENT_ID',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    additionalParams: { code_challenge_method: 'S256' },
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    clientIdEnv: 'FACEBOOK_APP_ID',
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'public_profile', 'email'],
  },
  instagram: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    clientIdEnv: 'FACEBOOK_APP_ID',
    scopes: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'pages_show_list', 'public_profile'],
    callbackProviderKey: 'instagram',
  },
  // Aliases — so /api/oauth/linkedin_oidc also works (returned by verifyMissionPermissions)
  linkedin_oidc: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    scopes: ['openid', 'profile', 'email', 'w_member_social'],
    callbackProviderKey: 'linkedin_oidc',
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const config = OAUTH_PROVIDERS[provider];

  if (!config) {
    return NextResponse.json(
      { error: `Unknown OAuth provider: ${provider}. Supported: ${Object.keys(OAUTH_PROVIDERS).join(', ')}` },
      { status: 400 }
    );
  }

  // Authenticate the user
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const clientId = process.env[config.clientIdEnv];
  if (!clientId) {
    return NextResponse.json(
      { error: `${config.clientIdEnv} is not configured. Add it to your environment variables.` },
      { status: 500 }
    );
  }

  // Use the callback provider key if different (e.g., linkedin -> linkedin_oidc)
  const callbackKey = config.callbackProviderKey || provider;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/oauth/callback/${callbackKey}`;

  // Build the authorization URL
  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.append('client_id', clientId);
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('response_type', 'code');

  // Add scopes
  if (config.scopes.length > 0) {
    const separator = config.scopeSeparator || ' ';
    authUrl.searchParams.append('scope', config.scopes.join(separator));
  }

  // Pass tenant ID as state parameter (used in callback to store tokens)
  authUrl.searchParams.append('state', authResult.tenantId);

  // Add any provider-specific additional parameters
  if (config.additionalParams) {
    for (const [key, value] of Object.entries(config.additionalParams)) {
      authUrl.searchParams.append(key, value);
    }
  }

  // ── Twitter PKCE: Generate code_verifier and code_challenge ──
  let codeVerifier = '';
  if (provider === 'twitter') {
    codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    authUrl.searchParams.set('code_challenge', codeChallenge);
  }

  const response = NextResponse.redirect(authUrl.toString());

  // Store code_verifier in a secure cookie for the callback to use
  if (codeVerifier) {
    response.cookies.set('twitter_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/api/oauth/callback',
    });
  }

  return response;
}
