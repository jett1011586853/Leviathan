import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  trainHeuristicCandidatesFromRollouts,
  type HeuristicTrainingResult,
} from './heuristicTrainer.js'
import type { LeviathanRolloutBundle } from './rolloutSchema.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export type TrainHeuristicCandidatesFromFilesInput = {
  training_run_id: string
  provider_model_id: string
  base_heuristic_bundle_version: string
  rollout_bundle_paths: string[]
  output_path: string
}

export type TrainHeuristicCandidatesFromFilesResult = {
  output_path: string
  training: HeuristicTrainingResult
}

function readRolloutBundle(path: string): LeviathanRolloutBundle {
  return jsonParse(readFileSync(path, 'utf8')) as LeviathanRolloutBundle
}

export function trainHeuristicCandidatesFromFiles(
  input: TrainHeuristicCandidatesFromFilesInput,
): TrainHeuristicCandidatesFromFilesResult {
  const rollouts = input.rollout_bundle_paths.map(readRolloutBundle)
  const training = trainHeuristicCandidatesFromRollouts({
    training_run_id: input.training_run_id,
    provider_model_id: input.provider_model_id,
    base_heuristic_bundle_version: input.base_heuristic_bundle_version,
    rollouts,
  })

  mkdirSync(dirname(input.output_path), { recursive: true })
  writeFileSync_DEPRECATED(input.output_path, jsonStringify(training, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })

  return {
    output_path: input.output_path,
    training,
  }
}
