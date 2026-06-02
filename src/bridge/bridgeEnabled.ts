import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../leviathan/branding.js'

export function isBridgeEnabled(): boolean {
  return false
}

export async function isBridgeEnabledBlocking(): Promise<boolean> {
  return false
}

export async function getBridgeDisabledReason(): Promise<string | null> {
  return LEGACY_ACCOUNT_FEATURE_NOTICE
}

export function isEnvLessBridgeEnabled(): boolean {
  return false
}

export function isCseShimEnabled(): boolean {
  return true
}

export function checkBridgeMinVersion(): string | null {
  return null
}

export function getCcrAutoConnectDefault(): boolean {
  return false
}

export function isCcrMirrorEnabled(): boolean {
  return false
}
