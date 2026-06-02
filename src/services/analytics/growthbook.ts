/**
 * Local feature configuration compatibility layer.
 *
 * Recovered code imports the historical feature API extensively. Leviathan
 * resolves those reads from local overrides and the existing disk cache only;
 * it does not create a remote evaluation client or refresh features online.
 */

import { isEqual } from 'lodash-es'
import {
  getGlobalConfig,
  saveGlobalConfig,
} from '../../utils/config.js'

export type GrowthBookUserAttributes = {
  id: string
  sessionId: string
  deviceID: string
  platform: 'win32' | 'darwin' | 'linux'
  apiBaseUrlHost?: string
  organizationUUID?: string
  accountUUID?: string
  userType?: string
  subscriptionType?: string
  rateLimitTier?: string
  firstTokenTime?: number
  email?: string
  appVersion?: string
  github?: unknown
}

type GrowthBookRefreshListener = () => void | Promise<void>

const listeners = new Set<GrowthBookRefreshListener>()
let envOverrides: Record<string, unknown> | null = null
let envOverridesParsed = false

function emitRefresh(): void {
  for (const listener of listeners) {
    try {
      void Promise.resolve(listener()).catch(() => {})
    } catch {
      // Feature listeners must not break local settings updates.
    }
  }
}

function getEnvOverrides(): Record<string, unknown> | null {
  if (!envOverridesParsed) {
    envOverridesParsed = true
    const raw = process.env.LEVIATHAN_FEATURE_OVERRIDES
    if (raw) {
      try {
        envOverrides = JSON.parse(raw) as Record<string, unknown>
      } catch {
        envOverrides = null
      }
    }
  }
  return envOverrides
}

function getConfigOverrides(): Record<string, unknown> | undefined {
  try {
    return getGlobalConfig().growthBookOverrides
  } catch {
    return undefined
  }
}

function getCachedFeature<T>(feature: string, defaultValue: T): T {
  const env = getEnvOverrides()
  if (env && feature in env) {
    return env[feature] as T
  }
  const local = getConfigOverrides()
  if (local && feature in local) {
    return local[feature] as T
  }
  try {
    const cached = getGlobalConfig().cachedGrowthBookFeatures?.[feature]
    return cached !== undefined ? (cached as T) : defaultValue
  } catch {
    return defaultValue
  }
}

export function onGrowthBookRefresh(
  listener: GrowthBookRefreshListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function hasGrowthBookEnvOverride(feature: string): boolean {
  const overrides = getEnvOverrides()
  return overrides !== null && feature in overrides
}

export function getAllGrowthBookFeatures(): Record<string, unknown> {
  try {
    return getGlobalConfig().cachedGrowthBookFeatures ?? {}
  } catch {
    return {}
  }
}

export function getGrowthBookConfigOverrides(): Record<string, unknown> {
  return getConfigOverrides() ?? {}
}

export function setGrowthBookConfigOverride(
  feature: string,
  value: unknown,
): void {
  saveGlobalConfig(config => {
    const current = config.growthBookOverrides ?? {}
    if (value === undefined) {
      if (!(feature in current)) return config
      const { [feature]: _, ...rest } = current
      if (Object.keys(rest).length === 0) {
        const { growthBookOverrides: __, ...withoutOverrides } = config
        return withoutOverrides
      }
      return { ...config, growthBookOverrides: rest }
    }
    if (isEqual(current[feature], value)) return config
    return {
      ...config,
      growthBookOverrides: { ...current, [feature]: value },
    }
  })
  emitRefresh()
}

export function clearGrowthBookConfigOverrides(): void {
  saveGlobalConfig(config => {
    if (!config.growthBookOverrides) return config
    const { growthBookOverrides: _, ...withoutOverrides } = config
    return withoutOverrides
  })
  emitRefresh()
}

export function getApiBaseUrlHost(): string | undefined {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) return undefined
  try {
    return new URL(baseUrl).hostname
  } catch {
    return undefined
  }
}

export async function initializeGrowthBook(): Promise<null> {
  return null
}

export async function getFeatureValue_DEPRECATED<T>(
  feature: string,
  defaultValue: T,
): Promise<T> {
  return getCachedFeature(feature, defaultValue)
}

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  feature: string,
  defaultValue: T,
): T {
  return getCachedFeature(feature, defaultValue)
}

export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  feature: string,
  defaultValue: T,
  _refreshIntervalMs: number,
): T {
  return getCachedFeature(feature, defaultValue)
}

export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  gate: string,
): boolean {
  const locallyConfigured = getCachedFeature<boolean | undefined>(
    gate,
    undefined,
  )
  if (locallyConfigured !== undefined) return Boolean(locallyConfigured)
  try {
    return Boolean(getGlobalConfig().cachedStatsigGates?.[gate])
  } catch {
    return false
  }
}

export async function checkSecurityRestrictionGate(
  gate: string,
): Promise<boolean> {
  try {
    const historicRestriction = getGlobalConfig().cachedStatsigGates?.[gate]
    if (historicRestriction !== undefined) return Boolean(historicRestriction)
  } catch {
    return false
  }
  return Boolean(getCachedFeature(gate, false))
}

export async function checkGate_CACHED_OR_BLOCKING(
  gate: string,
): Promise<boolean> {
  return Boolean(getCachedFeature(gate, false))
}

export function refreshGrowthBookAfterAuthChange(): void {}

export function resetGrowthBook(): void {}

export async function refreshGrowthBookFeatures(): Promise<void> {}

export function setupPeriodicGrowthBookRefresh(): void {}

export function stopPeriodicGrowthBookRefresh(): void {}

export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  configName: string,
  defaultValue: T,
): Promise<T> {
  return getCachedFeature(configName, defaultValue)
}

export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  configName: string,
  defaultValue: T,
): T {
  return getCachedFeature(configName, defaultValue)
}
