export type OfficialMarketplaceSkipReason = 'policy_blocked'

export type OfficialMarketplaceCheckResult = {
  installed: boolean
  skipped: boolean
  reason?: OfficialMarketplaceSkipReason
  configSaveFailed?: boolean
}

export function isOfficialMarketplaceAutoInstallDisabled(): boolean {
  return true
}

export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 0,
  INITIAL_DELAY_MS: 0,
  BACKOFF_MULTIPLIER: 0,
  MAX_DELAY_MS: 0,
}

/**
 * Recovered product-owned plugin catalogs are unavailable in Leviathan.
 */
export async function checkAndInstallOfficialMarketplace(): Promise<OfficialMarketplaceCheckResult> {
  return {
    installed: false,
    skipped: true,
    reason: 'policy_blocked',
  }
}
