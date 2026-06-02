/**
 * Compatibility boundary for the recovered built-in marketplace mirror.
 * Leviathan does not download product-owned plugin catalogs.
 */
export async function fetchOfficialMarketplaceFromGcs(
  _installLocation: string,
  _marketplacesCacheDir: string,
): Promise<string | null> {
  return null
}

export function classifyGcsError(_error: unknown): string {
  return 'disabled'
}
