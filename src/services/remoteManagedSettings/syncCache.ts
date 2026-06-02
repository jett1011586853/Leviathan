import {
  resetSyncCache as resetLeafCache,
  setEligibility,
} from './syncCacheState.js'

export function resetSyncCache(): void {
  resetLeafCache()
}

export function isRemoteManagedSettingsEligible(): boolean {
  return setEligibility(false)
}
