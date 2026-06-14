import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import type { LearningActivationState } from './learningActivationFiles.js'
import type { LearningBundle } from './learningBundleFiles.js'
import { redactText } from './redaction.js'
import { jsonParse } from '../utils/slowOperations.js'

export const ACTIVE_LEARNING_STATE_PATH_ENV =
  'LEVIATHAN_CODE_ACTIVE_LEARNING_STATE_PATH' as const

export type ActiveLearningRuntimeContext = {
  training_run_id: string
  provider_model_id: string
  provider_model_update: 'none'
  heuristic_bundle_version: string
  polar_harness_version: string
  enabled_feature_flags: string[]
  heuristic_candidates: Array<{
    id: string
    type: string
    source_failure_taxonomy: string[]
    learned_guidance: string[]
    feature_flag: string
  }>
  polar_updates: Array<{
    id: string
    failure_attribution: string
    target_harness_asset: string
    source_cases: string[]
    feature_flag: string
  }>
}

export type LoadActiveLearningRuntimeContextInput = {
  state_path?: string
}

function readJson<T>(path: string): T {
  return jsonParse(readFileSync(path, 'utf8')) as T
}

function resolveBundlePath(statePath: string, bundlePath: string): string {
  return isAbsolute(bundlePath) ? bundlePath : join(dirname(statePath), bundlePath)
}

function matchesActivatedBundle(
  state: LearningActivationState,
  bundle: LearningBundle,
): boolean {
  if (state.status !== 'active') return false
  if (bundle.status !== 'ready_for_activation') return false
  if (!bundle.stable_activation_allowed) return false
  if (state.provider_model_update !== 'none') return false
  if (bundle.provider_model_update !== 'none') return false
  if (state.training_run_id !== bundle.training_run_id) return false
  if (state.provider_model_id !== bundle.provider_model_id) return false
  if (state.heuristic_bundle_version !== bundle.heuristic_bundle.version) {
    return false
  }
  if (state.polar_harness_version !== bundle.polar_harness.version) return false
  return true
}

export function loadActiveLearningRuntimeContextFromFile(
  input: LoadActiveLearningRuntimeContextInput = {},
): ActiveLearningRuntimeContext | null {
  const statePath =
    input.state_path ?? process.env[ACTIVE_LEARNING_STATE_PATH_ENV]
  if (!statePath || !existsSync(statePath)) return null

  try {
    const state = readJson<LearningActivationState>(statePath)
    if (state.status !== 'active') return null

    const bundlePath = resolveBundlePath(statePath, state.active_bundle_path)
    if (!existsSync(bundlePath)) return null

    const bundle = readJson<LearningBundle>(bundlePath)
    if (!matchesActivatedBundle(state, bundle)) return null

    return {
      training_run_id: state.training_run_id,
      provider_model_id: state.provider_model_id,
      provider_model_update: 'none',
      heuristic_bundle_version: state.heuristic_bundle_version,
      polar_harness_version: state.polar_harness_version,
      enabled_feature_flags: [...state.enabled_feature_flags],
      heuristic_candidates: bundle.heuristic_bundle.candidates.map(candidate => ({
        id: candidate.id,
        type: candidate.type,
        source_failure_taxonomy: [...candidate.source_failure_taxonomy],
        learned_guidance: sanitizeGuidance(candidate.learned_guidance ?? []),
        feature_flag: candidate.feature_flag,
      })),
      polar_updates: bundle.polar_harness.updates.map(update => ({
        id: update.id,
        failure_attribution: update.failure_attribution,
        target_harness_asset: update.target_harness_asset,
        source_cases: [...update.source_cases],
        feature_flag: update.feature_flag,
      })),
    }
  } catch {
    return null
  }
}

function clean(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 180)
}

function isTrainingEvidenceGuidance(value: string): boolean {
  return /^Observed root-cause pattern from training rollouts:/i.test(
    value.trim(),
  )
}

function sanitizeGuidance(values: string[]): string[] {
  return values
    .filter(value => !isTrainingEvidenceGuidance(value))
    .map(value => redactText(value))
}

function cleanList(values: string[], limit = 8): string {
  const cleaned = values.map(clean).filter(value => value.length > 0).slice(0, limit)
  return cleaned.length > 0 ? cleaned.join(', ') : 'none'
}

export function renderActiveLearningRuntimeContext(
  context: ActiveLearningRuntimeContext | null | undefined,
): string {
  if (!context) return ''

  const heuristicLines = context.heuristic_candidates.slice(0, 12).map(candidate =>
    `- ${clean(candidate.id)}: ${clean(candidate.type)}; taxonomy=${cleanList(candidate.source_failure_taxonomy)}; guidance=${cleanList(candidate.learned_guidance, 4)}; feature_flag=${clean(candidate.feature_flag)}`,
  )
  const polarLines = context.polar_updates.slice(0, 12).map(update =>
    `- ${clean(update.id)}: target=${clean(update.target_harness_asset)}; attribution=${clean(update.failure_attribution)}; source_cases=${cleanList(update.source_cases)}; feature_flag=${clean(update.feature_flag)}`,
  )

  return [
    '# Leviathan Active Learning',
    'A locally activated HL + Polar harness learning bundle is active for this session.',
    `- Provider model id: ${clean(context.provider_model_id)}`,
    '- Provider model update: none',
    `- Training run id: ${clean(context.training_run_id)}`,
    `- Active heuristic bundle: ${clean(context.heuristic_bundle_version)}`,
    `- Active Polar harness version: ${clean(context.polar_harness_version)}`,
    `- Enabled feature flags: ${cleanList(context.enabled_feature_flags, 16)}`,
    'Use these entries as harness-side guidance for tool choice, failure recovery, rollout annotation, replay discipline, and Polar request/response capture. Do not fine-tune, mutate, or replace the connected provider model.',
    heuristicLines.length > 0 ? '## Active Heuristic Candidates' : null,
    ...heuristicLines,
    polarLines.length > 0 ? '## Active Polar Harness Updates' : null,
    ...polarLines,
  ]
    .filter(line => line !== null)
    .join('\n')
}

export function getActiveLearningPromptSection(): string | null {
  const rendered = renderActiveLearningRuntimeContext(
    loadActiveLearningRuntimeContextFromFile(),
  )
  return rendered.length > 0 ? rendered : null
}
