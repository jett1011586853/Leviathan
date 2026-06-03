import { readFileSync } from 'node:fs'

import type { BaselineMatrixInput, PolicyTrainability } from './baselineMatrix.js'
import type { BenchmarkTaskRecord } from './benchmarkGovernance.js'
import type { PolarProxySpikeObservation } from './polarProxySpike.js'
import type { RewardDesign } from './rewardDesign.js'
import type { RollbackIncidentPlan } from './rollbackIncidentPlan.js'
import type { LeviathanRolloutBundle } from './rolloutSchema.js'
import {
  buildTrainingReadinessEvidence,
  type ProviderScope,
  type ReplayReadinessEvidence,
} from './trainingReadinessEvidence.js'
import type { TrainingLaunchConfigFile } from './trainingRunFiles.js'
import { jsonParse } from '../utils/slowOperations.js'

export type TrainingEvidenceFilesInput = {
  provider_model_id: string
  provider_scope: ProviderScope
  git_commit: string
  cwd_alias: string
  rollback_checkpoint_tag: string
  policy_trainability?: PolicyTrainability
  rollout_bundle_paths: string[]
  replay_results_path?: string
  benchmark_records_path?: string
  polar_spike_observations_path?: string
  reward_design_path?: string
  baseline_matrix_path?: string
  rollback_incident_plan_path?: string
}

function readJsonFile<T>(path: string): T {
  return jsonParse(readFileSync(path, 'utf8')) as T
}

function readJsonArrayFile<T>(path: string | undefined): T[] | undefined {
  if (!path) return undefined
  const value = readJsonFile<unknown>(path)
  return Array.isArray(value) ? (value as T[]) : [value as T]
}

function readOptionalJsonFile<T>(path: string | undefined): T | undefined {
  return path ? readJsonFile<T>(path) : undefined
}

function defaultBaselineMatrix(
  policyTrainability: PolicyTrainability,
): BaselineMatrixInput {
  return {
    policy_trainability: policyTrainability,
    enabled_arms: ['baseline', 'hl_only', 'polar_only', 'hl_polar'],
  }
}

export function buildTrainingLaunchConfigFromEvidenceFiles(
  input: TrainingEvidenceFilesInput,
): TrainingLaunchConfigFile {
  const policy_trainability = input.policy_trainability ?? 'closed_api'
  const rollout_bundles = input.rollout_bundle_paths.map(path =>
    readJsonFile<LeviathanRolloutBundle>(path),
  )
  const replay_results =
    readJsonArrayFile<ReplayReadinessEvidence>(input.replay_results_path) ?? []
  const benchmark_records = readJsonArrayFile<BenchmarkTaskRecord>(
    input.benchmark_records_path,
  )
  const polar_spike_observations =
    readJsonArrayFile<PolarProxySpikeObservation>(
      input.polar_spike_observations_path,
    )
  const reward_design = readOptionalJsonFile<RewardDesign>(
    input.reward_design_path,
  )
  const baseline_matrix =
    readOptionalJsonFile<BaselineMatrixInput>(input.baseline_matrix_path) ??
    defaultBaselineMatrix(policy_trainability)
  const rollback_incident_plan = readOptionalJsonFile<RollbackIncidentPlan>(
    input.rollback_incident_plan_path,
  )

  return {
    provider_model_id: input.provider_model_id,
    policy_trainability,
    readiness_evidence: buildTrainingReadinessEvidence({
      rollout_bundles,
      replay_results,
      provider_scope: input.provider_scope,
      benchmark_records,
      polar_spike_observations,
      reward_design,
      baseline_matrix,
      rollback_and_incident_plan_ready: false,
      rollback_incident_plan,
    }),
    baseline_matrix,
    rollout_bundle_count: rollout_bundles.length,
    cwd_alias: input.cwd_alias,
    git_commit: input.git_commit,
    rollback_checkpoint_tag: input.rollback_checkpoint_tag,
  }
}
