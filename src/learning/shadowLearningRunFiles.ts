import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  createDefaultTrainingLaunchConfig,
  launchTrainingRunFromConfigFile,
  type TrainingLaunchConfigFile,
  writeTrainingLaunchConfigFile,
} from './trainingRunFiles.js'
import type { TrainingRunManifest } from './trainingRunManifest.js'
import {
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export const SHADOW_LEARNING_RUN_SCHEMA_VERSION =
  'leviathan.shadow_learning_run.v1' as const

export type ShadowLearningRunStatus = 'collecting_rollouts'

export type ShadowLearningRunSplitPlan = {
  train: number
  dev: number
  held_out: number
}

export type ShadowLearningRun = {
  schema_version: typeof SHADOW_LEARNING_RUN_SCHEMA_VERSION
  status: ShadowLearningRunStatus
  run_id: string
  created_at: string
  provider_model_id: string
  provider_model_update: 'none'
  git_commit: string
  cwd_alias: string
  rollback_checkpoint_tag: string
  target_rollout_count: number
  minimum_trainable_rollouts: number
  split_plan: ShadowLearningRunSplitPlan
  artifacts: ShadowLearningRunPaths
  next_actions: string[]
}

export type ShadowLearningRunPaths = {
  output_dir: string
  launch_config: string
  formal_manifest: string
  shadow_manifest: string
  raw_rollouts_dir: string
  annotated_train_dir: string
  annotated_dev_dir: string
  annotated_held_out_dir: string
  evidence_dir: string
  pipeline_dir: string
  active_state_path: string
}

export type InitializeShadowLearningRunInput = {
  output_dir: string
  run_id: string
  provider_model_id: string
  created_at: string
  git_commit: string
  rollback_checkpoint_tag: string
  cwd_alias?: string
  target_rollout_count?: number
  minimum_trainable_rollouts?: number
}

export type InitializeShadowLearningRunResult = {
  run: ShadowLearningRun
  paths: ShadowLearningRunPaths
  formal_manifest: TrainingRunManifest
}

function splitPlan(targetRolloutCount: number): ShadowLearningRunSplitPlan {
  const train = Math.floor(targetRolloutCount * 0.6)
  const dev = Math.floor(targetRolloutCount * 0.2)
  return {
    train,
    dev,
    held_out: targetRolloutCount - train - dev,
  }
}

function paths(outputDir: string): ShadowLearningRunPaths {
  return {
    output_dir: outputDir,
    launch_config: join(outputDir, 'launch.json'),
    formal_manifest: join(outputDir, 'formal-launch-manifest.json'),
    shadow_manifest: join(outputDir, 'shadow-learning-run.json'),
    raw_rollouts_dir: join(outputDir, 'rollouts', 'raw'),
    annotated_train_dir: join(outputDir, 'rollouts', 'annotated', 'train'),
    annotated_dev_dir: join(outputDir, 'rollouts', 'annotated', 'dev'),
    annotated_held_out_dir: join(outputDir, 'rollouts', 'annotated', 'held_out'),
    evidence_dir: join(outputDir, 'evidence'),
    pipeline_dir: join(outputDir, 'pipeline'),
    active_state_path: join(outputDir, 'active-learning.json'),
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync_DEPRECATED(path, jsonStringify(value, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })
}

function createShadowLaunchConfig(
  input: InitializeShadowLearningRunInput,
): TrainingLaunchConfigFile {
  return {
    ...createDefaultTrainingLaunchConfig({
      provider_model_id: input.provider_model_id,
      git_commit: input.git_commit,
      cwd_alias: input.cwd_alias,
      rollback_checkpoint_tag: input.rollback_checkpoint_tag,
      rollout_bundle_count: 0,
    }),
    readiness_evidence: {
      concept_boundaries_fixed: true,
      trainable_policy_boundaries_fixed: true,
      rollout_schema_v1_implemented: true,
      required_fields_landable: false,
      optional_field_degradation_defined: true,
      data_redaction_exporter_implemented: true,
      replay_runner_fixed_task_reproducible: false,
      failure_taxonomy_covers_high_frequency_failures: false,
      heuristic_promotion_gate_implemented: true,
      updater_candidate_only_enforced: true,
      benchmark_splits_isolated: false,
      polar_proxy_spike_cases_passed: false,
      provider_scope_locked_direct_anthropic: true,
      sparse_outcome_reward_defined: false,
      baseline_matrix_fixed: true,
      result_reporting_split_by_source: true,
      rollback_and_incident_plan_ready: false,
    },
  }
}

export function initializeShadowLearningRun(
  input: InitializeShadowLearningRunInput,
): InitializeShadowLearningRunResult {
  const target_rollout_count = input.target_rollout_count ?? 50
  const runPaths = paths(input.output_dir)

  for (const dir of [
    input.output_dir,
    runPaths.raw_rollouts_dir,
    runPaths.annotated_train_dir,
    runPaths.annotated_dev_dir,
    runPaths.annotated_held_out_dir,
    runPaths.evidence_dir,
    runPaths.pipeline_dir,
  ]) {
    mkdirSync(dir, { recursive: true })
  }

  writeTrainingLaunchConfigFile(
    runPaths.launch_config,
    createShadowLaunchConfig(input),
  )

  const formal = launchTrainingRunFromConfigFile({
    config_path: runPaths.launch_config,
    output_path: runPaths.formal_manifest,
    run_id: input.run_id,
    created_at: input.created_at,
  })

  const run: ShadowLearningRun = {
    schema_version: SHADOW_LEARNING_RUN_SCHEMA_VERSION,
    status: 'collecting_rollouts',
    run_id: input.run_id,
    created_at: input.created_at,
    provider_model_id: input.provider_model_id,
    provider_model_update: 'none',
    git_commit: input.git_commit,
    cwd_alias: input.cwd_alias ?? '$WORKDIR',
    rollback_checkpoint_tag: input.rollback_checkpoint_tag,
    target_rollout_count,
    minimum_trainable_rollouts: input.minimum_trainable_rollouts ?? 20,
    split_plan: splitPlan(target_rollout_count),
    artifacts: runPaths,
    next_actions: [
      'Collect and export redacted rollout bundles into rollouts/raw.',
      'Annotate trainable samples into rollouts/annotated/train, rollouts/annotated/dev, and rollouts/annotated/held_out.',
      'Add replay, security, complexity, target-slice, regression, reward, baseline, rollback, and Polar spike evidence into evidence.',
      'Run /learning run-pipeline only after train/dev/held-out evidence is present.',
      'Activate learning-bundle.json only after promotion gates produce a ready learning bundle.',
    ],
  }

  writeJson(runPaths.shadow_manifest, run)

  return {
    run,
    paths: runPaths,
    formal_manifest: formal.manifest,
  }
}
