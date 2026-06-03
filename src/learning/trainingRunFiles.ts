import { readFileSync } from 'node:fs'

import {
  evaluateTrainingLaunch,
  type TrainingLaunchRequest,
} from './trainingLaunch.js'
import {
  createTrainingRunManifest,
  type TrainingRunManifest,
} from './trainingRunManifest.js'
import type { BaselineMatrixInput, PolicyTrainability } from './baselineMatrix.js'
import type { TrainingReadinessEvidence } from './trainingReadiness.js'
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

export type LaunchTrainingRunFromConfigFileResult = {
  output_path: string
  manifest: TrainingRunManifest
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

  writeFileSync_DEPRECATED(input.output_path, jsonStringify(manifest, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })

  return {
    output_path: input.output_path,
    manifest,
  }
}
