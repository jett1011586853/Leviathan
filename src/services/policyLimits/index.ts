/**
 * Compatibility boundary for recovered account-backed policy limits.
 *
 * Locally deployed settings remain active through the regular settings
 * pipeline. Leviathan does not load or enforce remote account policy state.
 */

import { unlink } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

const CACHE_FILENAME = 'policy-limits.json'

function getCachePath(): string {
  return join(getClaudeConfigHomeDir(), CACHE_FILENAME)
}

export function _resetPolicyLimitsForTesting(): void {}

export function initializePolicyLimitsLoadingPromise(): void {}

export function isPolicyLimitsEligible(): boolean {
  return false
}

export async function waitForPolicyLimitsToLoad(): Promise<void> {}

export function isPolicyAllowed(_policy: string): boolean {
  return true
}

export async function clearPolicyLimitsCache(): Promise<void> {
  try {
    await unlink(getCachePath())
  } catch {
    // Missing legacy cache is expected after the product boundary is removed.
  }
}

export async function loadPolicyLimits(): Promise<void> {
  await clearPolicyLimitsCache()
}

export async function refreshPolicyLimits(): Promise<void> {
  await clearPolicyLimitsCache()
}

export function startBackgroundPolling(): void {}

export function stopBackgroundPolling(): void {}
