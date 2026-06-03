import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { HeuristicTrainingResult } from './heuristicTrainer.js'
import {
  evaluatePromotionCandidate,
  type PromotionDecision,
  type PromotionEvidence,
} from './promotionGate.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export const HEURISTIC_PROMOTION_REPORT_SCHEMA_VERSION =
  'leviathan.heuristic_promotion_report.v1' as const

export type HeuristicPromotionReportStatus =
  | 'ready_for_stable_promotion'
  | 'rejected'
  | 'blocked'

export type HeuristicPromotionCandidateDecision = PromotionDecision & {
  candidate_id: string
}

export type HeuristicPromotionReport = {
  schema_version: typeof HEURISTIC_PROMOTION_REPORT_SCHEMA_VERSION
  status: HeuristicPromotionReportStatus
  training_run_id: string
  provider_model_id: string
  provider_model_update: 'none'
  source_candidate_bundle_version: string
  stable_promotions_allowed: boolean
  decisions: HeuristicPromotionCandidateDecision[]
  blocked_reasons: string[]
}

export type WriteHeuristicPromotionReportFromFilesInput = {
  training_path: string
  evidence_path: string
  output_path: string
}

export type WriteHeuristicPromotionReportFromFilesResult = {
  output_path: string
  report: HeuristicPromotionReport
}

function readTraining(path: string): HeuristicTrainingResult {
  return jsonParse(readFileSync(path, 'utf8')) as HeuristicTrainingResult
}

function readEvidence(path: string): PromotionEvidence {
  return jsonParse(readFileSync(path, 'utf8')) as PromotionEvidence
}

function blockedReport(
  training: HeuristicTrainingResult,
  blocked_reasons: string[],
): HeuristicPromotionReport {
  return {
    schema_version: HEURISTIC_PROMOTION_REPORT_SCHEMA_VERSION,
    status: 'blocked',
    training_run_id: training.training_run_id,
    provider_model_id: training.provider_model_id,
    provider_model_update: 'none',
    source_candidate_bundle_version: training.candidate_heuristic_bundle_version,
    stable_promotions_allowed: false,
    decisions: [],
    blocked_reasons,
  }
}

export function buildHeuristicPromotionReport(
  training: HeuristicTrainingResult,
  evidence: PromotionEvidence,
): HeuristicPromotionReport {
  if (training.status !== 'candidate_only') {
    return blockedReport(training, [
      `training.status.${training.status}`,
      ...training.blocked_reasons,
    ])
  }

  if (!training.candidates.length) {
    return blockedReport(training, ['training.candidates.empty'])
  }

  const decisions = training.candidates.map(candidate => ({
    candidate_id: candidate.id,
    ...evaluatePromotionCandidate(candidate, evidence),
  }))
  const stable_promotions_allowed = decisions.every(
    decision => decision.stable_allowed,
  )

  return {
    schema_version: HEURISTIC_PROMOTION_REPORT_SCHEMA_VERSION,
    status: stable_promotions_allowed ? 'ready_for_stable_promotion' : 'rejected',
    training_run_id: training.training_run_id,
    provider_model_id: training.provider_model_id,
    provider_model_update: 'none',
    source_candidate_bundle_version: training.candidate_heuristic_bundle_version,
    stable_promotions_allowed,
    decisions,
    blocked_reasons: [],
  }
}

export function writeHeuristicPromotionReportFromFiles(
  input: WriteHeuristicPromotionReportFromFilesInput,
): WriteHeuristicPromotionReportFromFilesResult {
  const report = buildHeuristicPromotionReport(
    readTraining(input.training_path),
    readEvidence(input.evidence_path),
  )

  mkdirSync(dirname(input.output_path), { recursive: true })
  writeFileSync_DEPRECATED(input.output_path, jsonStringify(report, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })

  return {
    output_path: input.output_path,
    report,
  }
}
