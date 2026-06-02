/**
 * Prefetch an explicitly stored provider API key on macOS while startup
 * imports are loading. Product account credentials are not read by Leviathan.
 */

import { execFile } from 'child_process'
import { isBareMode } from '../envUtils.js'
import {
  getMacOsKeychainStorageServiceName,
  getUsername,
} from './macOsKeychainHelpers.js'

const KEYCHAIN_PREFETCH_TIMEOUT_MS = 10_000

let providerApiKeyPrefetch: { stdout: string | null } | null = null
let prefetchPromise: Promise<void> | null = null

type SpawnResult = { stdout: string | null; timedOut: boolean }

function spawnSecurity(serviceName: string): Promise<SpawnResult> {
  return new Promise(resolve => {
    execFile(
      'security',
      ['find-generic-password', '-a', getUsername(), '-w', '-s', serviceName],
      { encoding: 'utf-8', timeout: KEYCHAIN_PREFETCH_TIMEOUT_MS },
      (err, stdout) => {
        resolve({
          stdout: err ? null : stdout?.trim() || null,
          timedOut: Boolean(err && 'killed' in err && err.killed),
        })
      },
    )
  })
}

export function startKeychainPrefetch(): void {
  if (process.platform !== 'darwin' || prefetchPromise || isBareMode()) return

  prefetchPromise = spawnSecurity(getMacOsKeychainStorageServiceName()).then(
    result => {
      if (!result.timedOut) {
        providerApiKeyPrefetch = { stdout: result.stdout }
      }
    },
  )
}

export async function ensureKeychainPrefetchCompleted(): Promise<void> {
  if (prefetchPromise) await prefetchPromise
}

export function getLegacyApiKeyPrefetchResult(): {
  stdout: string | null
} | null {
  return providerApiKeyPrefetch
}

export function clearLegacyApiKeyPrefetch(): void {
  providerApiKeyPrefetch = null
}
