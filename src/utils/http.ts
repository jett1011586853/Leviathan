/**
 * HTTP utility constants and helpers.
 */

import { getAnthropicApiKey } from './auth.js'
import { getLeviathanUserAgent } from './userAgent.js'
import { getWorkload } from './workloadContext.js'

export function getUserAgent(): string {
  const agentSdkVersion = process.env.LEVIATHAN_AGENT_SDK_VERSION
    ? `, agent-sdk/${process.env.LEVIATHAN_AGENT_SDK_VERSION}`
    : ''
  const clientApp = process.env.LEVIATHAN_AGENT_SDK_CLIENT_APP
    ? `, client-app/${process.env.LEVIATHAN_AGENT_SDK_CLIENT_APP}`
    : ''
  const workload = getWorkload()
  const workloadSuffix = workload ? `, workload/${workload}` : ''
  return `leviathan-cli/${MACRO.VERSION} (${process.env.USER_TYPE}, ${process.env.LEVIATHAN_CODE_ENTRYPOINT ?? 'cli'}${agentSdkVersion}${clientApp}${workloadSuffix})`
}

export function getMCPUserAgent(): string {
  const parts: string[] = []
  if (process.env.LEVIATHAN_CODE_ENTRYPOINT) {
    parts.push(process.env.LEVIATHAN_CODE_ENTRYPOINT)
  }
  if (process.env.LEVIATHAN_AGENT_SDK_VERSION) {
    parts.push(`agent-sdk/${process.env.LEVIATHAN_AGENT_SDK_VERSION}`)
  }
  if (process.env.LEVIATHAN_AGENT_SDK_CLIENT_APP) {
    parts.push(`client-app/${process.env.LEVIATHAN_AGENT_SDK_CLIENT_APP}`)
  }
  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `leviathan-code/${MACRO.VERSION}${suffix}`
}

export function getWebFetchUserAgent(): string {
  return `Leviathan-User (${getLeviathanUserAgent()}; +https://leviathan.local/support)`
}

export type AuthHeaders = {
  headers: Record<string, string>
  error?: string
}

export function getAuthHeaders(): AuthHeaders {
  const apiKey = getAnthropicApiKey()
  if (!apiKey) {
    return {
      headers: {},
      error: 'No API key available',
    }
  }
  return {
    headers: {
      'x-api-key': apiKey,
    },
  }
}

export async function withOAuth401Retry<T>(
  request: () => Promise<T>,
  _opts?: { also403Revoked?: boolean },
): Promise<T> {
  return request()
}
