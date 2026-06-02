import memoize from 'lodash-es/memoize.js'
import type { ScopedMcpServerConfig } from './types.js'

/**
 * Compatibility boundary for recovered account-managed MCP connectors.
 * Leviathan supports configured standard MCP servers only.
 */
export const fetchClaudeAIMcpConfigsIfEligible = memoize(
  async (): Promise<Record<string, ScopedMcpServerConfig>> => {
    return {}
  },
)

export function clearClaudeAIMcpConfigsCache(): void {
  fetchClaudeAIMcpConfigsIfEligible.cache.clear?.()
}

export function markClaudeAiMcpConnected(_name: string): void {}

export function hasClaudeAiMcpEverConnected(_name: string): boolean {
  return false
}
