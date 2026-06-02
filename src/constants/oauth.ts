export function fileSuffixForOauthConfig(): string {
  return ''
}

export const LEVIATHAN_INFERENCE_SCOPE = 'user:inference' as const
export const LEVIATHAN_PROFILE_SCOPE = 'user:profile' as const
const CONSOLE_SCOPE = 'org:create_api_key' as const
export const OAUTH_BETA_HEADER = 'oauth-2025-04-20' as const

export const CONSOLE_OAUTH_SCOPES = [
  CONSOLE_SCOPE,
  LEVIATHAN_PROFILE_SCOPE,
] as const

export const LEVIATHAN_OAUTH_SCOPES = [
  LEVIATHAN_PROFILE_SCOPE,
  LEVIATHAN_INFERENCE_SCOPE,
  'user:mcp_servers',
  'user:file_upload',
] as const

export const ALL_OAUTH_SCOPES = Array.from(
  new Set([...CONSOLE_OAUTH_SCOPES, ...LEVIATHAN_OAUTH_SCOPES]),
)

type OauthConfig = {
  BASE_API_URL: string
  CONSOLE_AUTHORIZE_URL: string
  LEVIATHAN_AUTHORIZE_URL: string
  LEVIATHAN_ORIGIN: string
  TOKEN_URL: string
  API_KEY_URL: string
  ROLES_URL: string
  CONSOLE_SUCCESS_URL: string
  LEVIATHAN_SUCCESS_URL: string
  MANUAL_REDIRECT_URL: string
  CLIENT_ID: string
  OAUTH_FILE_SUFFIX: string
  MCP_PROXY_URL: string
  MCP_PROXY_PATH: string
}

const LEVIATHAN_LOCAL_ORIGIN = 'https://leviathan.local'

export const MCP_CLIENT_METADATA_URL =
  `${LEVIATHAN_LOCAL_ORIGIN}/oauth/leviathan-code-client-metadata`

export function getOauthConfig(): OauthConfig {
  const baseApiUrl =
    process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, '') ??
    'https://api.anthropic.com'

  return {
    BASE_API_URL: baseApiUrl,
    CONSOLE_AUTHORIZE_URL: `${LEVIATHAN_LOCAL_ORIGIN}/oauth-disabled/authorize`,
    LEVIATHAN_AUTHORIZE_URL: `${LEVIATHAN_LOCAL_ORIGIN}/oauth-disabled/authorize`,
    LEVIATHAN_ORIGIN: LEVIATHAN_LOCAL_ORIGIN,
    TOKEN_URL: `${LEVIATHAN_LOCAL_ORIGIN}/oauth-disabled/token`,
    API_KEY_URL: `${LEVIATHAN_LOCAL_ORIGIN}/oauth-disabled/create-api-key`,
    ROLES_URL: `${LEVIATHAN_LOCAL_ORIGIN}/oauth-disabled/roles`,
    CONSOLE_SUCCESS_URL: `${LEVIATHAN_LOCAL_ORIGIN}/oauth-disabled/success?app=leviathan-code`,
    LEVIATHAN_SUCCESS_URL: `${LEVIATHAN_LOCAL_ORIGIN}/oauth-disabled/success?app=leviathan-code`,
    MANUAL_REDIRECT_URL: `${LEVIATHAN_LOCAL_ORIGIN}/oauth-disabled/callback`,
    CLIENT_ID: 'leviathan-code-local',
    OAUTH_FILE_SUFFIX: '',
    MCP_PROXY_URL: `${LEVIATHAN_LOCAL_ORIGIN}/mcp-proxy`,
    MCP_PROXY_PATH: '/v1/mcp/{server_id}',
  }
}
