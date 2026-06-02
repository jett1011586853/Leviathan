import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import {
  AggregationTemporality,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics'

/**
 * Compatibility-only exporter retained for imports outside the default runtime.
 * Leviathan does not upload product metrics to a built-in endpoint.
 */
export class BigQueryMetricsExporter implements PushMetricExporter {
  export(
    _metrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void,
  ): void {
    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  async shutdown(): Promise<void> {}

  async forceFlush(): Promise<void> {}

  selectAggregationTemporality(): AggregationTemporality {
    return AggregationTemporality.DELTA
  }
}
