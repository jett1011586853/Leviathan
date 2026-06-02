import { attachAnalyticsSink } from '../services/analytics/index.js'
import { initializeErrorLogSink } from './errorLogSink.js'

/**
 * Attach local sinks. Product analytics events are consumed without being
 * transmitted, while local error handling remains available.
 */
export function initSinks(): void {
  initializeErrorLogSink()
  attachAnalyticsSink({
    logEvent: () => {},
    logEventAsync: () => Promise.resolve(),
  })
}
