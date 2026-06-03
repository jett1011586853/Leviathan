import {
  measureFailureTaxonomyCoverage,
} from './failureTaxonomy.js'
import {
  summarizeBenchmarkSources,
  validateBenchmarkSplits,
  type BenchmarkTaskRecord,
} from './benchmarkGovernance.js'
import {
  ROLLOUT_SCHEMA_VERSION,
  type LeviathanRolloutBundle,
} from './rolloutSchema.js'
import {
  evaluatePolarProxySpike,
  type PolarProxySpikeObservation,
} from './polarProxySpike.js'
import type { TrainingReadinessEvidence } from './trainingReadiness.js'

export type ProviderScope =
  | 'anthropic-compatible-direct'
  | 'mixed'
  | 'unknown'

export type ReplayReadinessEvidence = {
  status: 'completed' | 'blocked'
  blockers: string[]
  compare_passed?: boolean
}

export type BuildTrainingReadinessEvidenceInput = {
  rollout_bundles: LeviathanRolloutBundle[]
  replay_results: ReplayReadinessEvidence[]
  provider_scope: ProviderScope
  benchmark_splits_isolated?: boolean
  benchmark_records?: BenchmarkTaskRecord[]
  polar_proxy_spike_cases_passed?: boolean
  polar_spike_observations?: PolarProxySpikeObservation[]
  sparse_outcome_reward_defined: boolean
  rollback_and_incident_plan_ready: boolean
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function requiredRolloutFieldsPresent(bundle: LeviathanRolloutBundle): boolean {
  return (
    bundle.schema_version === ROLLOUT_SCHEMA_VERSION &&
    hasText(bundle.run.run_id) &&
    hasText(bundle.run.session_id) &&
    hasText(bundle.run.task_id) &&
    hasText(bundle.run.harness_version) &&
    hasText(bundle.run.heuristic_bundle_version) &&
    hasText(bundle.run.policy_version) &&
    hasText(bundle.task.user_instruction) &&
    hasText(bundle.task.repo) &&
    hasText(bundle.task.base_commit) &&
    hasText(bundle.task.cwd_alias) &&
    hasText(bundle.runtime.network_policy) &&
    hasText(bundle.security.redaction_profile)
  )
}

function replayEvidencePassed(results: ReplayReadinessEvidence[]): boolean {
  return (
    results.length > 0 &&
    results.every(
      result =>
        result.status === 'completed' &&
        result.blockers.length === 0 &&
        result.compare_passed === true,
    )
  )
}

export function buildTrainingReadinessEvidence(
  input: BuildTrainingReadinessEvidenceInput,
): TrainingReadinessEvidence {
  const taxonomyCoverage = measureFailureTaxonomyCoverage(input.rollout_bundles)
  const benchmarkGovernance =
    input.benchmark_records !== undefined
      ? validateBenchmarkSplits(input.benchmark_records)
      : null
  const sourceSummary =
    input.benchmark_records !== undefined
      ? summarizeBenchmarkSources(input.benchmark_records)
      : null
  const polarSpikeResult =
    input.polar_spike_observations !== undefined
      ? evaluatePolarProxySpike(input.polar_spike_observations)
      : null

  return {
    concept_boundaries_fixed: true,
    trainable_policy_boundaries_fixed: true,
    rollout_schema_v1_implemented: true,
    required_fields_landable:
      input.rollout_bundles.length > 0 &&
      input.rollout_bundles.every(requiredRolloutFieldsPresent),
    optional_field_degradation_defined: true,
    data_redaction_exporter_implemented: true,
    replay_runner_fixed_task_reproducible: replayEvidencePassed(
      input.replay_results,
    ),
    failure_taxonomy_covers_high_frequency_failures:
      taxonomyCoverage.ready_at_80_percent,
    heuristic_promotion_gate_implemented: true,
    updater_candidate_only_enforced: true,
    benchmark_splits_isolated:
      benchmarkGovernance?.isolated ?? input.benchmark_splits_isolated ?? false,
    polar_proxy_spike_cases_passed:
      polarSpikeResult?.passed ?? input.polar_proxy_spike_cases_passed ?? false,
    provider_scope_locked_direct_anthropic:
      input.provider_scope === 'anthropic-compatible-direct',
    sparse_outcome_reward_defined: input.sparse_outcome_reward_defined,
    baseline_matrix_fixed: true,
    result_reporting_split_by_source:
      sourceSummary === null
        ? true
        : sourceSummary.internal + sourceSummary.public + sourceSummary.private_secret >
          0,
    rollback_and_incident_plan_ready: input.rollback_and_incident_plan_ready,
  }
}
