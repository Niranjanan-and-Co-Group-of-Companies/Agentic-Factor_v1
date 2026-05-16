// ============================================================
// OAuth Provider Registry — Dynamic provider configurations
// Each provider has its OAuth endpoints, env var keys, and
// default scopes. Adding a new provider = adding an entry here.
// ============================================================

export interface OAuthProviderConfig {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  defaultScopes: string[];
  scopeDelimiter?: string; // Default is ' ' (space)
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    id: 'google',
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    defaultScopes: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
  },

  github: {
    id: 'github',
    name: 'GitHub',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET',
    defaultScopes: ['repo', 'read:user', 'user:email', 'read:org'],
  },

  slack: {
    id: 'slack',
    name: 'Slack',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
    defaultScopes: ['chat:write', 'channels:read', 'channels:history', 'users:read'],
    scopeDelimiter: ',',
  },

  notion: {
    id: 'notion',
    name: 'Notion',
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    clientIdEnv: 'NOTION_CLIENT_ID',
    clientSecretEnv: 'NOTION_CLIENT_SECRET',
    defaultScopes: [], // Notion uses OAuth client permissions, not scopes
  },

  discord: {
    id: 'discord',
    name: 'Discord',
    authUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    clientIdEnv: 'DISCORD_CLIENT_ID',
    clientSecretEnv: 'DISCORD_CLIENT_SECRET',
    defaultScopes: ['bot', 'identify', 'guilds', 'messages.read'],
  },
};

/**
 * Get a provider config. Returns null if provider doesn't exist or isn't configured.
 */
export function getProvider(providerId: string): OAuthProviderConfig | null {
  const provider = OAUTH_PROVIDERS[providerId];
  if (!provider) return null;

  // Check if env vars are set
  const clientId = process.env[provider.clientIdEnv];
  if (!clientId) return null;

  return provider;
}

/**
 * Get all configured (usable) providers.
 */
export function getConfiguredProviders(): OAuthProviderConfig[] {
  return Object.values(OAUTH_PROVIDERS).filter(p => !!process.env[p.clientIdEnv]);
}
