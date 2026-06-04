import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { buildTrainingLaunchConfigFromEvidenceFiles } from './trainingEvidenceFiles.js'
import {
  launchTrainingRunFromConfigFile,
  writeTrainingLaunchConfigFile,
} from './trainingRunFiles.js'
import type { TrainingRunManifest } from './trainingRunManifest.js'
import type { ShadowLearningRun } from './shadowLearningRunFiles.js'
import {
  readShadowLearningRunStatusFromFiles,
  writeShadowLearningRunStatusFile,
  type ShadowLearningRunStatusSnapshot,
} from './shadowLearningRunStatusFiles.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export const SHADOW_LEARNING_COLLECTION_SCHEMA_VERSION =
  'leviathan.shadow_learning_collection.v1' as const

export type ShadowLearningCollectionStatus = 'blocked' | 'collected'

export type ShadowLearningEvidencePaths = {
  replay_results: string
  failure_taxonomy: string
  benchmark_records: string
  polar_spike_observations: string
  reward_design: string
  rollback_incident_plan: string
}

export type ShadowLearningRunCollectionReport = {
  schema_version: typeof SHADOW_LEARNING_COLLECTION_SCHEMA_VERSION
  status: ShadowLearningCollectionStatus
  run_id: string
  created_at: string
  provider_model_id: string
  provider_model_update: 'none'
  launch_config_path: string
  formal_manifest_path: string
  status_path: string
  rollout_bundle_paths: string[]
  training_rollout_paths: string[]
  development_rollout_paths: string[]
  held_out_rollout_paths: string[]
  evidence_paths: Partial<ShadowLearningEvidencePaths>
  formal_manifest_status: TrainingRunManifest['status'] | null
  blocked_reasons: string[]
  next_actions: string[]
}

export type CollectShadowLearningRunFromFilesInput = {
  run_dir: string
  created_at: string
}

export type WriteShadowLearningRunCollectionFileInput =
  CollectShadowLearningRunFromFilesInput & {
    output_path?: string
  }

export type ShadowLearningRunCollectionFileResult = {
  output_path: string
  report: ShadowLearningRunCollectionReport
}

function readJsonFile<T>(path: string): T {
  return jsonParse(readFileSync(path, 'utf8')) as T
}

function resolveRunPath(
  runDir: string,
  path: string | undefined,
  fallback: string,
): string {
  if (!path) return join(runDir, fallback)
  if (isAbsolute(path) || existsSync(path)) return path
  return join(runDir, fallback)
}

function jsonFilePaths(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => join(dir, entry.name))
    .sort()
}

function shadowManifestPath(runDir: string): string {
  return join(runDir, 'shadow-learning-run.json')
}

function defaultCollectionPath(runDir: string): string {
  return join(runDir, 'shadow-collection.json')
}

function defaultStatusPath(runDir: string): string {
  return join(runDir, 'shadow-status.json')
}

function evidenceFileMap(evidenceDir: string): ShadowLearningEvidencePaths {
  return {
    replay_results: join(evidenceDir, 'replay-results.json'),
    failure_taxonomy: join(evidenceDir, 'failure-taxonomy.json'),
    benchmark_records: join(evidenceDir, 'benchmark-splits.json'),
    polar_spike_observations: join(
      evidenceDir,
      'polar-spike-observations.json',
    ),
    reward_design: join(evidenceDir, 'reward-design.json'),
    rollback_incident_plan: join(evidenceDir, 'rollback-incident-plan.json'),
  }
}

function readinessBlockers(
  status: ShadowLearningRunStatusSnapshot,
): string[] {
  const blockers: string[] = []
  if (!status.readiness.raw_rollouts_collected) {
    blockers.push('raw_rollouts_collected')
  }
  if (!status.readiness.minimum_trainable_rollouts_ready) {
    blockers.push('minimum_trainable_rollouts_ready')
  }
  if (!status.readiness.train_split_ready) blockers.push('train_split_ready')
  if (!status.readiness.dev_split_ready) blockers.push('dev_split_ready')
  if (!status.readiness.held_out_split_ready) {
    blockers.push('held_out_split_ready')
  }
  if (!status.readiness.evidence_files_present) {
    blockers.push('evidence_files_present')
  }
  return blockers
}

function runArtifactPaths(runDir: string, run: ShadowLearningRun) {
  const artifacts = run.artifacts
  return {
    launchConfig: resolveRunPath(
      runDir,
      artifacts.launch_config,
      'launch.json',
    ),
    formalManifest: resolveRunPath(
      runDir,
      artifacts.formal_manifest,
      'formal-launch-manifest.json',
    ),
    trainDir: resolveRunPath(
      runDir,
      artifacts.annotated_train_dir,
      join('rollouts', 'annotated', 'train'),
    ),
    devDir: resolveRunPath(
      runDir,
      artifacts.annotated_dev_dir,
      join('rollouts', 'annotated', 'dev'),
    ),
    heldOutDir: resolveRunPath(
      runDir,
      artifacts.annotated_held_out_dir,
      join('rollouts', 'annotated', 'held_out'),
    ),
    evidenceDir: resolveRunPath(runDir, artifacts.evidence_dir, 'evidence'),
  }
}

function blockedReport(input: {
  run: ShadowLearningRun
  createdAt: string
  launchConfigPath: string
  formalManifestPath: string
  statusPath: string
  evidencePaths: Partial<ShadowLearningEvidencePaths>
  blockedReasons: string[]
  nextActions: string[]
}): ShadowLearningRunCollectionReport {
  return {
    schema_version: SHADOW_LEARNING_COLLECTION_SCHEMA_VERSION,
    status: 'blocked',
    run_id: input.run.run_id,
    created_at: input.createdAt,
    provider_model_id: input.run.provider_model_id,
    provider_model_update: 'none',
    launch_config_path: input.launchConfigPath,
    formal_manifest_path: input.formalManifestPath,
    status_path: input.statusPath,
    rollout_bundle_paths: [],
    training_rollout_paths: [],
    development_rollout_paths: [],
    held_out_rollout_paths: [],
    evidence_paths: input.evidencePaths,
    formal_manifest_status: null,
    blocked_reasons: input.blockedReasons,
    next_actions: input.nextActions,
  }
}

export function collectShadowLearningRunFromFiles(
  input: CollectShadowLearningRunFromFilesInput,
): ShadowLearningRunCollectionReport {
  const run = readJsonFile<ShadowLearningRun>(shadowManifestPath(input.run_dir))
  const paths = runArtifactPaths(input.run_dir, run)
  const statusPath = defaultStatusPath(input.run_dir)
  const evidencePaths = evidenceFileMap(paths.evidenceDir)
  const statusBefore = writeShadowLearningRunStatusFile({
    run_dir: input.run_dir,
    output_path: statusPath,
  }).status
  const precheckBlockers = readinessBlockers(statusBefore)

  if (precheckBlockers.length > 0) {
    return blockedReport({
      run,
      createdAt: input.created_at,
      launchConfigPath: paths.launchConfig,
      formalManifestPath: paths.formalManifest,
      statusPath,
      evidencePaths,
      blockedReasons: precheckBlockers,
      nextActions: statusBefore.next_actions,
    })
  }

  const trainingRollouts = jsonFilePaths(paths.trainDir)
  const developmentRollouts = jsonFilePaths(paths.devDir)
  const heldOutRollouts = jsonFilePaths(paths.heldOutDir)
  const rolloutBundlePaths = [
    ...trainingRollouts,
    ...developmentRollouts,
    ...heldOutRollouts,
  ]

  writeTrainingLaunchConfigFile(
    paths.launchConfig,
    buildTrainingLaunchConfigFromEvidenceFiles({
      provider_model_id: run.provider_model_id,
      provider_scope: 'anthropic-compatible-direct',
      git_commit: run.git_commit,
      cwd_alias: run.cwd_alias,
      rollback_checkpoint_tag: run.rollback_checkpoint_tag,
      rollout_bundle_paths: rolloutBundlePaths,
      replay_results_path: evidencePaths.replay_results,
      benchmark_records_path: evidencePaths.benchmark_records,
      polar_spike_observations_path: evidencePaths.polar_spike_observations,
      reward_design_path: evidencePaths.reward_design,
      rollback_incident_plan_path: evidencePaths.rollback_incident_plan,
    }),
  )

  const launch = launchTrainingRunFromConfigFile({
    config_path: paths.launchConfig,
    output_path: paths.formalManifest,
    run_id: run.run_id,
    created_at: input.created_at,
  })
  const statusAfter = readShadowLearningRunStatusFromFiles({
    run_dir: input.run_dir,
  })
  writeShadowLearningRunStatusFile({
    run_dir: input.run_dir,
    output_path: statusPath,
  })
  const blockedReasons = launch.manifest.blocked?.reasons ?? []

  return {
    schema_version: SHADOW_LEARNING_COLLECTION_SCHEMA_VERSION,
    status: launch.manifest.status === 'started' ? 'collected' : 'blocked',
    run_id: run.run_id,
    created_at: input.created_at,
    provider_model_id: run.provider_model_id,
    provider_model_update: 'none',
    launch_config_path: paths.launchConfig,
    formal_manifest_path: paths.formalManifest,
    status_path: statusPath,
    rollout_bundle_paths: rolloutBundlePaths,
    training_rollout_paths: trainingRollouts,
    development_rollout_paths: developmentRollouts,
    held_out_rollout_paths: heldOutRollouts,
    evidence_paths: evidencePaths,
    formal_manifest_status: launch.manifest.status,
    blocked_reasons: blockedReasons,
    next_actions:
      launch.manifest.status === 'started'
        ? statusAfter.next_actions
        : blockedReasons,
  }
}

export function writeShadowLearningRunCollectionFile(
  input: WriteShadowLearningRunCollectionFileInput,
): ShadowLearningRunCollectionFileResult {
  const outputPath = input.output_path ?? defaultCollectionPath(input.run_dir)
  const report = collectShadowLearningRunFromFiles({
    run_dir: input.run_dir,
    created_at: input.created_at,
  })

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync_DEPRECATED(outputPath, jsonStringify(report, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })

  return {
    output_path: outputPath,
    report,
  }
}
