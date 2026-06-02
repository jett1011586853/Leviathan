/**
 * Compatibility boundary for recovered account-backed managed settings.
 *
 * Leviathan keeps locally deployed managed settings, but never retrieves
 * account-managed configuration from a product service.
 */

import { createHash } from 'crypto'
import { unlink } from 'fs/promises'
import type { SettingsJson } from '../../utils/settings/types.js'
import { getSettingsPath, resetSyncCache } from './syncCacheState.js'

function sortKeysDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortKeysDeep)
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep((obj as Record<string, unknown>)[key])
    }
    return sorted
  }
  return obj
}

export function computeChecksumFromSettings(settings: SettingsJson): string {
  const normalized = JSON.stringify(sortKeysDeep(settings))
  const hash = createHash('sha256').update(normalized).digest('hex')
  return `sha256:${hash}`
}

export function initializeRemoteManagedSettingsLoadingPromise(): void {}

export function isEligibleForRemoteManagedSettings(): boolean {
  return false
}

export async function waitForRemoteManagedSettingsToLoad(): Promise<void> {}

export async function clearRemoteManagedSettingsCache(): Promise<void> {
  resetSyncCache()
  try {
    await unlink(getSettingsPath())
  } catch {
    // Missing legacy cache is expected after the product boundary is removed.
  }
}

export async function loadRemoteManagedSettings(): Promise<void> {
  await clearRemoteManagedSettingsCache()
}

export async function refreshRemoteManagedSettings(): Promise<void> {
  await clearRemoteManagedSettingsCache()
}

export function startBackgroundPolling(): void {}

export function stopBackgroundPolling(): void {}
