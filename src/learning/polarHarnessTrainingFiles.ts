import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  trainPolarHarnessCandidates,
  type PolarHarnessTrainingResult,
} from './polarHarnessTrainer.js'
import type { PolarProxySpikeObservation } from './polarProxySpike.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export type TrainPolarHarnessCandidatesFromFilesInput = {
  training_run_id: string
  provider_model_id: string
  base_harness_version: string
  observations_path: string
  output_path: string
}

export type TrainPolarHarnessCandidatesFromFilesResult = {
  output_path: string
  training: PolarHarnessTrainingResult
}

function readObservations(path: string): PolarProxySpikeObservation[] {
  const value = jsonParse(readFileSync(path, 'utf8')) as unknown
  return Array.isArray(value)
    ? (value as PolarProxySpikeObservation[])
    : [value as PolarProxySpikeObservation]
}

export function trainPolarHarnessCandidatesFromFiles(
  input: TrainPolarHarnessCandidatesFromFilesInput,
): TrainPolarHarnessCandidatesFromFilesResult {
  const training = trainPolarHarnessCandidates({
    training_run_id: input.training_run_id,
    provider_model_id: input.provider_model_id,
    base_harness_version: input.base_harness_version,
    observations: readObservations(input.observations_path),
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
