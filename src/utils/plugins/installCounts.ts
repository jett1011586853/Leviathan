/**
 * Plugin install counts are not sourced until a Leviathan-owned statistics
 * endpoint is configured. Returning null lets the plugin UI omit rankings
 * without contacting recovered product infrastructure.
 */
export async function getInstallCounts(): Promise<Map<string, number> | null> {
  return null
}

/**
 * Format a configured install count for display.
 */
export function formatInstallCount(count: number): string {
  if (count < 1000) {
    return String(count)
  }

  if (count < 1000000) {
    const k = count / 1000
    const formatted = k.toFixed(1)
    return formatted.endsWith('.0')
      ? `${formatted.slice(0, -2)}K`
      : `${formatted}K`
  }

  const m = count / 1000000
  const formatted = m.toFixed(1)
  return formatted.endsWith('.0')
    ? `${formatted.slice(0, -2)}M`
    : `${formatted}M`
}
