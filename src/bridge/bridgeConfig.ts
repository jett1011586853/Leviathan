import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../leviathan/branding.js'

export const BRIDGE_ACCOUNT_FEATURE_NOTICE = LEGACY_ACCOUNT_FEATURE_NOTICE

export function getBridgeTokenOverride(): string | undefined {
  return undefined
}

export function getBridgeBaseUrlOverride(): string | undefined {
  return undefined
}

export function getBridgeAccessToken(): string | undefined {
  return undefined
}

export function getBridgeBaseUrl(): string {
  return 'https://leviathan.local/bridge'
}
