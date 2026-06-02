import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'
import type { AccountInfo } from '../../utils/config.js'
import {
  type BillingType,
  type OAuthProfileResponse,
  type OAuthTokenExchangeResponse,
  type OAuthTokens,
  type RateLimitTier,
  type SubscriptionType,
} from './types.js'

const INFERENCE_SCOPE = 'user:inference'

export function shouldUseLegacyAccountAuth(scopes: string[] | undefined): boolean {
  return Boolean(scopes?.includes(INFERENCE_SCOPE))
}

export function parseScopes(scopeString?: string): string[] {
  return scopeString?.split(' ').filter(Boolean) ?? []
}

export function buildAuthUrl(_options: {
  codeChallenge: string
  state: string
  port: number
  isManual: boolean
  loginWithLegacyAccount?: boolean
  inferenceOnly?: boolean
  orgUUID?: string
  loginHint?: string
  loginMethod?: string
}): string {
  throw new Error(LEGACY_ACCOUNT_FEATURE_NOTICE)
}

export async function exchangeCodeForTokens(
  _authorizationCode: string,
  _state: string,
  _codeVerifier: string,
  _port: number,
  _useManualRedirect: boolean = false,
  _expiresIn?: number,
): Promise<OAuthTokenExchangeResponse> {
  throw new Error(LEGACY_ACCOUNT_FEATURE_NOTICE)
}

export async function refreshOAuthToken(
  _refreshToken: string,
  _options: { scopes?: string[] } = {},
): Promise<OAuthTokens> {
  throw new Error(LEGACY_ACCOUNT_FEATURE_NOTICE)
}

export async function fetchAndStoreUserRoles(
  _accessToken: string,
): Promise<void> {}

export async function createAndStoreApiKey(
  _accessToken: string,
): Promise<string | null> {
  return null
}

export function isOAuthTokenExpired(expiresAt: number | null): boolean {
  if (expiresAt === null) {
    return false
  }

  const bufferTime = 5 * 60 * 1000
  const now = Date.now()
  const expiresWithBuffer = now + bufferTime
  return expiresWithBuffer >= expiresAt
}

export async function fetchProfileInfo(_accessToken: string): Promise<{
  subscriptionType: SubscriptionType | null
  displayName?: string
  rateLimitTier: RateLimitTier | null
  hasExtraUsageEnabled: boolean | null
  billingType: BillingType | null
  accountCreatedAt?: string
  subscriptionCreatedAt?: string
  rawProfile?: OAuthProfileResponse
}> {
  return {
    subscriptionType: null,
    rateLimitTier: null,
    hasExtraUsageEnabled: null,
    billingType: null,
  }
}

export async function getOrganizationUUID(): Promise<string | null> {
  return null
}

export async function populateOAuthAccountInfoIfNeeded(): Promise<boolean> {
  return false
}

export function storeOAuthAccountInfo(_accountInfo: AccountInfo): void {}
