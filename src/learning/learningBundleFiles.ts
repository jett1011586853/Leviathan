import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type {
  HeuristicTrainingResult,
} from './heuristicTrainer.js'
import type {
  PolarHarnessCandidateUpdate,
  PolarHarnessTrainingResult,
} from './polarHarnessTrainer.js'
import type { HeuristicCandidate } from './promotionGate.js'
import type { HeuristicPromotionReport } from './promotionFiles.js'
import type { PolarHarnessPromotionReport } from './polarHarnessPromotionFiles.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export const LEARNING_BUNDLE_SCHEMA_VERSION =
  'leviathan.learning_bundle.v1' as const

export type LearningBundleStatus = 'ready_for_activation' | 'blocked'

export type LearningBundle = {
  schema_version: typeof LEARNING_BUNDLE_SCHEMA_VERSION
  status: LearningBundleStatus
  training_run_id: string
  provider_model_id: string
  provider_model_update: 'none'
  stable_activation_allowed: boolean
  heuristic_bundle: {
    version: string
    source_candidate_bundle_version: string
    candidates: HeuristicCandidate[]
  }
  polar_harness: {
    version: string
    source_candidate_harness_version: string
    updates: PolarHarnessCandidateUpdate[]
  }
  rollback: {
    feature_flags: string[]
    plans: string[]
  }
  blocked_reasons: string[]
}

export type WriteLearningBundleFromFilesInput = {
  heuristic_training_path: string
  heuristic_promotion_report_path: string
  polar_training_path: string
  polar_promotion_report_path: string
  output_path: string
  stable_heuristic_bundle_version?: string
  stable_harness_version?: string
}

export type WriteLearningBundleFromFilesResult = {
  output_path: string
  bundle: LearningBundle
}

type BuildLearningBundleInput = {
  heuristic_training: HeuristicTrainingResult
  heuristic_report: HeuristicPromotionReport
  polar_training: PolarHarnessTrainingResult
  polar_report: PolarHarnessPromotionReport
  stable_heuristic_bundle_version?: string
  stable_harness_version?: string
}

function readJson<T>(path: string): T {
  return jsonParse(readFileSync(path, 'utf8')) as T
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(value => value.trim().length > 0))]
}

function promotedCandidateIds(report: HeuristicPromotionReport): Set<string> {
  return new Set(
    report.decisions
      .filter(
        decision => decision.decision === 'promote' && decision.stable_allowed,
      )
      .map(decision => decision.candidate_id),
  )
}

function promotedUpdateIds(report: PolarHarnessPromotionReport): Set<string> {
  return new Set(
    report.decisions
      .filter(
        decision => decision.decision === 'promote' && decision.stable_allowed,
      )
      .map(decision => decision.update_id),
  )
}

function collectBlockers(input: BuildLearningBundleInput): string[] {
  const blockers: string[] = []

  if (input.heuristic_training.status !== 'candidate_only') {
    blockers.push(`heuristic_training.status.${input.heuristic_training.status}`)
    blockers.push(...input.heuristic_training.blocked_reasons)
  }
  if (input.polar_training.status !== 'candidate_only') {
    blockers.push(`polar_training.status.${input.polar_training.status}`)
    blockers.push(...input.polar_training.blocked_reasons)
  }
  if (input.heuristic_report.status !== 'ready_for_stable_promotion') {
    blockers.push(`heuristic_report.status.${input.heuristic_report.status}`)
    blockers.push(...input.heuristic_report.blocked_reasons)
  }
  if (!input.heuristic_report.stable_promotions_allowed) {
    blockers.push('heuristic_report.stable_promotions_allowed')
  }
  if (input.polar_report.status !== 'ready_for_stable_promotion') {
    blockers.push(`polar_report.status.${input.polar_report.status}`)
    blockers.push(...input.polar_report.blocked_reasons)
  }
  if (!input.polar_report.stable_promotions_allowed) {
    blockers.push('polar_report.stable_promotions_allowed')
  }

  if (
    input.heuristic_training.training_run_id !==
      input.heuristic_report.training_run_id ||
    input.heuristic_training.training_run_id !==
      input.polar_training.training_run_id ||
    input.heuristic_training.training_run_id !== input.polar_report.training_run_id
  ) {
    blockers.push('training_run_id.mismatch')
  }

  if (
    input.heuristic_training.provider_model_id !==
      input.heuristic_report.provider_model_id ||
    input.heuristic_training.provider_model_id !==
      input.polar_training.provider_model_id ||
    input.heuristic_training.provider_model_id !==
      input.polar_report.provider_model_id
  ) {
    blockers.push('provider_model_id.mismatch')
  }

  return unique(blockers)
}

export function buildLearningBundle(
  input: BuildLearningBundleInput,
): LearningBundle {
  const blocked_reasons = collectBlockers(input)
  const candidateIds = promotedCandidateIds(input.heuristic_report)
  const updateIds = promotedUpdateIds(input.polar_report)
  const promotedCandidates = input.heuristic_training.candidates.filter(candidate =>
    candidateIds.has(candidate.id),
  )
  const promotedUpdates = input.polar_training.updates.filter(update =>
    updateIds.has(update.id),
  )

  if (blocked_reasons.length === 0 && promotedCandidates.length === 0) {
    blocked_reasons.push('heuristic_candidates.promoted.empty')
  }
  if (blocked_reasons.length === 0 && promotedUpdates.length === 0) {
    blocked_reasons.push('polar_updates.promoted.empty')
  }

  const ready = blocked_reasons.length === 0
  const candidates = ready ? promotedCandidates : []
  const updates = ready ? promotedUpdates : []
  const training_run_id = input.heuristic_training.training_run_id

  return {
    schema_version: LEARNING_BUNDLE_SCHEMA_VERSION,
    status: ready ? 'ready_for_activation' : 'blocked',
    training_run_id,
    provider_model_id: input.heuristic_training.provider_model_id,
    provider_model_update: 'none',
    stable_activation_allowed: ready,
    heuristic_bundle: {
      version:
        input.stable_heuristic_bundle_version ?? `hb:stable/${training_run_id}`,
      source_candidate_bundle_version:
        input.heuristic_training.candidate_heuristic_bundle_version,
      candidates,
    },
    polar_harness: {
      version: input.stable_harness_version ?? `polar:stable/${training_run_id}`,
      source_candidate_harness_version:
        input.polar_training.candidate_harness_version,
      updates,
    },
    rollback: {
      feature_flags: unique([
        ...candidates.map(candidate => candidate.feature_flag),
        ...updates.map(update => update.feature_flag),
      ]),
      plans: unique([
        ...candidates.map(candidate => candidate.rollback_plan),
        ...updates.map(update => update.rollback_plan),
      ]),
    },
    blocked_reasons,
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync_DEPRECATED(path, jsonStringify(value, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })
}

export function writeLearningBundleFromFiles(
  input: WriteLearningBundleFromFilesInput,
): WriteLearningBundleFromFilesResult {
  const bundle = buildLearningBundle({
    heuristic_training: readJson<HeuristicTrainingResult>(
      input.heuristic_training_path,
    ),
    heuristic_report: readJson<HeuristicPromotionReport>(
      input.heuristic_promotion_report_path,
    ),
    polar_training: readJson<PolarHarnessTrainingResult>(
      input.polar_training_path,
    ),
    polar_report: readJson<PolarHarnessPromotionReport>(
      input.polar_promotion_report_path,
    ),
    stable_heuristic_bundle_version: input.stable_heuristic_bundle_version,
    stable_harness_version: input.stable_harness_version,
  })

  writeJson(input.output_path, bundle)

  return {
    output_path: input.output_path,
    bundle,
  }
}
