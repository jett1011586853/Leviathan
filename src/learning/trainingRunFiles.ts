import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  evaluateTrainingLaunch,
  type TrainingLaunchRequest,
} from './trainingLaunch.js'
import {
  createTrainingRunManifest,
  type TrainingRunManifest,
} from './trainingRunManifest.js'
import type { BaselineMatrixInput, PolicyTrainability } from './baselineMatrix.js'
import {
  TRAINING_READINESS_CHECKS,
  type TrainingReadinessEvidence,
} from './trainingReadiness.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export type TrainingLaunchConfigFile = {
  provider_model_id: string
  policy_trainability: PolicyTrainability
  readiness_evidence: TrainingReadinessEvidence
  baseline_matrix: BaselineMatrixInput
  rollout_bundle_count: number
  cwd_alias: string
  git_commit: string
  rollback_checkpoint_tag: string
}

export type LaunchTrainingRunFromConfigFileInput = {
  config_path: string
  output_path: string
  run_id: string
  created_at: string
}

export type DefaultTrainingLaunchConfigInput = {
  provider_model_id: string
  git_commit: string
  cwd_alias?: string
  rollback_checkpoint_tag?: string
  rollout_bundle_count?: number
}

export type LaunchTrainingRunFromConfigFileResult = {
  output_path: string
  manifest: TrainingRunManifest
}

function emptyReadinessEvidence(): TrainingReadinessEvidence {
  return Object.fromEntries(
    TRAINING_READINESS_CHECKS.map(check => [check.id, false]),
  ) as TrainingReadinessEvidence
}

export function createDefaultTrainingLaunchConfig(
  input: DefaultTrainingLaunchConfigInput,
): TrainingLaunchConfigFile {
  return {
    provider_model_id: input.provider_model_id,
    policy_trainability: 'closed_api',
    readiness_evidence: emptyReadinessEvidence(),
    baseline_matrix: {
      policy_trainability: 'closed_api',
      enabled_arms: ['baseline', 'hl_only', 'polar_only', 'hl_polar'],
    },
    rollout_bundle_count: input.rollout_bundle_count ?? 0,
    cwd_alias: input.cwd_alias ?? '$WORKDIR',
    git_commit: input.git_commit,
    rollback_checkpoint_tag:
      input.rollback_checkpoint_tag ??
      'checkpoint/hl-polar-readiness-foundation-v1.0',
  }
}

export function writeTrainingLaunchConfigFile(
  path: string,
  config: TrainingLaunchConfigFile,
): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync_DEPRECATED(path, jsonStringify(config, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })
}

function readTrainingLaunchConfig(path: string): TrainingLaunchConfigFile {
  return jsonParse(readFileSync(path, 'utf8')) as TrainingLaunchConfigFile
}

function toLaunchRequest(
  config: TrainingLaunchConfigFile,
): TrainingLaunchRequest {
  return {
    mode: 'formal',
    provider_model_id: config.provider_model_id,
    policy_trainability: config.policy_trainability,
    readiness_evidence: config.readiness_evidence,
    baseline_matrix: config.baseline_matrix,
    rollout_bundle_count: config.rollout_bundle_count,
  }
}

export function launchTrainingRunFromConfigFile(
  input: LaunchTrainingRunFromConfigFileInput,
): LaunchTrainingRunFromConfigFileResult {
  const config = readTrainingLaunchConfig(input.config_path)
  const launch_decision = evaluateTrainingLaunch(toLaunchRequest(config))
  const manifest = createTrainingRunManifest({
    run_id: input.run_id,
    created_at: input.created_at,
    cwd_alias: config.cwd_alias,
    git_commit: config.git_commit,
    rollback_checkpoint_tag: config.rollback_checkpoint_tag,
    launch_decision,
  })

  mkdirSync(dirname(input.output_path), { recursive: true })
  writeFileSync_DEPRECATED(input.output_path, jsonStringify(manifest, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })

  return {
    output_path: input.output_path,
    manifest,
  }
}
