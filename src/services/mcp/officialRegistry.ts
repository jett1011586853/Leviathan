/**
 * Local compatibility boundary for the recovered managed MCP registry.
 *
 * Leviathan does not retrieve product-curated MCP metadata. Configured local
 * MCP servers continue to work; they are simply not classified by this source.
 */

export async function prefetchOfficialMcpUrls(): Promise<void> {}

export function isOfficialMcpUrl(_normalizedUrl: string): boolean {
  return false
}

export function resetOfficialMcpUrlsForTesting(): void {}
