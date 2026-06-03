import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { PolarHarnessTrainingResult } from './polarHarnessTrainer.js'
import {
  evaluatePolarHarnessPromotionUpdate,
  type PolarHarnessPromotionDecision,
  type PolarHarnessPromotionEvidence,
} from './polarHarnessPromotion.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export const POLAR_HARNESS_PROMOTION_REPORT_SCHEMA_VERSION =
  'leviathan.polar_harness_promotion_report.v1' as const

export type PolarHarnessPromotionReportStatus =
  | 'ready_for_stable_promotion'
  | 'rejected'
  | 'blocked'

export type PolarHarnessPromotionUpdateDecision =
  PolarHarnessPromotionDecision & {
    update_id: string
  }

export type PolarHarnessPromotionReport = {
  schema_version: typeof POLAR_HARNESS_PROMOTION_REPORT_SCHEMA_VERSION
  status: PolarHarnessPromotionReportStatus
  training_run_id: string
  provider_model_id: string
  provider_model_update: 'none'
  source_candidate_harness_version: string
  stable_promotions_allowed: boolean
  decisions: PolarHarnessPromotionUpdateDecision[]
  blocked_reasons: string[]
}

export type WritePolarHarnessPromotionReportFromFilesInput = {
  training_path: string
  evidence_path: string
  output_path: string
}

export type WritePolarHarnessPromotionReportFromFilesResult = {
  output_path: string
  report: PolarHarnessPromotionReport
}

function readTraining(path: string): PolarHarnessTrainingResult {
  return jsonParse(readFileSync(path, 'utf8')) as PolarHarnessTrainingResult
}

function readEvidence(path: string): PolarHarnessPromotionEvidence {
  return jsonParse(readFileSync(path, 'utf8')) as PolarHarnessPromotionEvidence
}

function blockedReport(
  training: PolarHarnessTrainingResult,
  blocked_reasons: string[],
): PolarHarnessPromotionReport {
  return {
    schema_version: POLAR_HARNESS_PROMOTION_REPORT_SCHEMA_VERSION,
    status: 'blocked',
    training_run_id: training.training_run_id,
    provider_model_id: training.provider_model_id,
    provider_model_update: 'none',
    source_candidate_harness_version: training.candidate_harness_version,
    stable_promotions_allowed: false,
    decisions: [],
    blocked_reasons,
  }
}

export function buildPolarHarnessPromotionReport(
  training: PolarHarnessTrainingResult,
  evidence: PolarHarnessPromotionEvidence,
): PolarHarnessPromotionReport {
  if (training.status !== 'candidate_only') {
    return blockedReport(training, [
      `training.status.${training.status}`,
      ...training.blocked_reasons,
    ])
  }

  if (!training.updates.length) {
    return blockedReport(training, ['training.updates.empty'])
  }

  const decisions = training.updates.map(update => ({
    update_id: update.id,
    ...evaluatePolarHarnessPromotionUpdate(update, evidence),
  }))
  const stable_promotions_allowed = decisions.every(
    decision => decision.stable_allowed,
  )

  return {
    schema_version: POLAR_HARNESS_PROMOTION_REPORT_SCHEMA_VERSION,
    status: stable_promotions_allowed ? 'ready_for_stable_promotion' : 'rejected',
    training_run_id: training.training_run_id,
    provider_model_id: training.provider_model_id,
    provider_model_update: 'none',
    source_candidate_harness_version: training.candidate_harness_version,
    stable_promotions_allowed,
    decisions,
    blocked_reasons: [],
  }
}

export function writePolarHarnessPromotionReportFromFiles(
  input: WritePolarHarnessPromotionReportFromFilesInput,
): WritePolarHarnessPromotionReportFromFilesResult {
  const report = buildPolarHarnessPromotionReport(
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
