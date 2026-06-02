type MetricsStatus = {
  enabled: boolean
  hasError: boolean
}

/**
 * Compatibility boundary for the removed product-metrics preference service.
 * The built-in metrics uploader is disabled in Leviathan.
 */
export async function checkMetricsEnabled(): Promise<MetricsStatus> {
  return { enabled: false, hasError: false }
}

export const _clearMetricsEnabledCacheForTesting = (): void => {}
