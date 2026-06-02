/**
 * No-network compatibility sink for recovered analytics call sites.
 *
 * Leviathan accepts analytics calls made by shared local code but does not
 * route them to product telemetry backends.
 */

import { attachAnalyticsSink } from './index.js'

export function initializeAnalyticsGates(): void {}

export function initializeAnalyticsSink(): void {
  attachAnalyticsSink({
    logEvent: () => {},
    logEventAsync: () => Promise.resolve(),
  })
}
