import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { LearningBundle } from './learningBundleFiles.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export const LEARNING_ACTIVATION_SCHEMA_VERSION =
  'leviathan.learning_activation.v1' as const

export type LearningActivationStateStatus = 'active' | 'blocked'

export type LearningActivationState = {
  schema_version: typeof LEARNING_ACTIVATION_SCHEMA_VERSION
  status: LearningActivationStateStatus
  active_bundle_path: string
  activated_at: string
  activated_by: string
  training_run_id: string
  provider_model_id: string
  provider_model_update: 'none'
  heuristic_bundle_version: string
  polar_harness_version: string
  enabled_feature_flags: string[]
  rollback_plans: string[]
  previous: LearningActivationSnapshot | null
  blocked_reasons: string[]
}

export type LearningActivationSnapshot = Omit<
  LearningActivationState,
  'previous'
> & {
  previous: null
}

export type ActivateLearningBundleFromFilesInput = {
  bundle_path: string
  state_path: string
  activated_at: string
  activated_by: string
}

export type ActivateLearningBundleFromFilesResult = {
  state_path: string
  state: LearningActivationState
  wrote_state: boolean
}

export type RollbackLearningActivationFileInput = {
  state_path: string
  rolled_back_at: string
}

export type RollbackLearningActivationFileResult = {
  state_path: string
  state: LearningActivationState
  rolled_back_from: LearningActivationSnapshot | null
}

function readJson<T>(path: string): T {
  return jsonParse(readFileSync(path, 'utf8')) as T
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync_DEPRECATED(path, jsonStringify(value, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(value => value.trim().length > 0))]
}

function readExistingState(path: string): LearningActivationState | null {
  return existsSync(path) ? readJson<LearningActivationState>(path) : null
}

function toSnapshot(
  state: LearningActivationState | null,
): LearningActivationSnapshot | null {
  if (!state || state.status !== 'active') return null
  return {
    ...state,
    previous: null,
  }
}

function activationBlockers(bundle: LearningBundle): string[] {
  const blockers: string[] = []
  if (bundle.status !== 'ready_for_activation') {
    blockers.push(`bundle.status.${bundle.status}`)
  }
  if (!bundle.stable_activation_allowed) {
    blockers.push('bundle.stable_activation_allowed')
  }
  blockers.push(...bundle.blocked_reasons)
  return unique(blockers)
}

function buildActiveState(
  input: ActivateLearningBundleFromFilesInput,
  bundle: LearningBundle,
  previous: LearningActivationSnapshot | null,
): LearningActivationState {
  return {
    schema_version: LEARNING_ACTIVATION_SCHEMA_VERSION,
    status: 'active',
    active_bundle_path: input.bundle_path,
    activated_at: input.activated_at,
    activated_by: input.activated_by,
    training_run_id: bundle.training_run_id,
    provider_model_id: bundle.provider_model_id,
    provider_model_update: 'none',
    heuristic_bundle_version: bundle.heuristic_bundle.version,
    polar_harness_version: bundle.polar_harness.version,
    enabled_feature_flags: unique(bundle.rollback.feature_flags),
    rollback_plans: unique(bundle.rollback.plans),
    previous,
    blocked_reasons: [],
  }
}

function blockedState(
  input: ActivateLearningBundleFromFilesInput,
  bundle: LearningBundle,
  blocked_reasons: string[],
): LearningActivationState {
  return {
    schema_version: LEARNING_ACTIVATION_SCHEMA_VERSION,
    status: 'blocked',
    active_bundle_path: input.bundle_path,
    activated_at: input.activated_at,
    activated_by: input.activated_by,
    training_run_id: bundle.training_run_id,
    provider_model_id: bundle.provider_model_id,
    provider_model_update: 'none',
    heuristic_bundle_version: bundle.heuristic_bundle.version,
    polar_harness_version: bundle.polar_harness.version,
    enabled_feature_flags: [],
    rollback_plans: [],
    previous: null,
    blocked_reasons,
  }
}

export function activateLearningBundleFromFiles(
  input: ActivateLearningBundleFromFilesInput,
): ActivateLearningBundleFromFilesResult {
  const bundle = readJson<LearningBundle>(input.bundle_path)
  const blocked_reasons = activationBlockers(bundle)
  if (blocked_reasons.length > 0) {
    return {
      state_path: input.state_path,
      state: blockedState(input, bundle, blocked_reasons),
      wrote_state: false,
    }
  }

  const state = buildActiveState(
    input,
    bundle,
    toSnapshot(readExistingState(input.state_path)),
  )
  writeJson(input.state_path, state)

  return {
    state_path: input.state_path,
    state,
    wrote_state: true,
  }
}

export function rollbackLearningActivationFile(
  input: RollbackLearningActivationFileInput,
): RollbackLearningActivationFileResult {
  const current = readExistingState(input.state_path)
  if (!current?.previous) {
    const state: LearningActivationState = current ?? {
      schema_version: LEARNING_ACTIVATION_SCHEMA_VERSION,
      status: 'blocked',
      active_bundle_path: '',
      activated_at: input.rolled_back_at,
      activated_by: 'rollback',
      training_run_id: '',
      provider_model_id: '',
      provider_model_update: 'none',
      heuristic_bundle_version: '',
      polar_harness_version: '',
      enabled_feature_flags: [],
      rollback_plans: [],
      previous: null,
      blocked_reasons: ['activation.previous.empty'],
    }
    return {
      state_path: input.state_path,
      state,
      rolled_back_from: null,
    }
  }

  const rolled_back_from = toSnapshot(current)
  const state: LearningActivationState = {
    ...current.previous,
    activated_at: input.rolled_back_at,
    activated_by: 'rollback',
    previous: null,
  }
  writeJson(input.state_path, state)

  return {
    state_path: input.state_path,
    state,
    rolled_back_from,
  }
}
