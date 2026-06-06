import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { PolarHarnessPromotionEvidence } from './polarHarnessPromotion.js'
import type { PromotionEvidence } from './promotionGate.js'
import type { RolloutFinalOutcome } from './rolloutSchema.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export type HeldOutEvaluationResult = {
  passed: boolean
  task_id?: string
  split?: string
  final_outcome?: RolloutFinalOutcome
  resolved_label?: boolean | null
  taxonomy?: string[]
  exit_codes?: number[]
  test_commands?: string[]
  test_outputs_count?: number
  changed_files?: string[]
  root_cause_summary?: string
}

export type HeldOutEvaluationSummary = {
  total: number
  passed: number
  failed: number
  regression_count: number
  unresolved_count: number
  unknown_count: number
  by_taxonomy: Record<string, number>
}

export type PromotionEvidenceSnapshot = {
  replay_results: { passed: boolean }[]
  held_out_results: HeldOutEvaluationResult[]
  held_out_summary?: HeldOutEvaluationSummary
  security_scan: { passed: boolean }
  complexity_budget: {
    passed: boolean
    token_turn_cost_regression_pct: number
  }
  target_failure_slice: {
    before_success_rate: number
    after_success_rate: number
    min_delta?: number
  }
  regressions: { p0_p1_count: number }
  polar_spike?: { passed: boolean }
}

export type WritePromotionEvidenceFromSnapshotFilesInput = {
  snapshot_path: string
  heuristic_output_path: string
  polar_output_path: string
}

export type WritePromotionEvidenceFromSnapshotFilesResult = {
  heuristic_output_path: string
  polar_output_path: string
  heuristic_evidence: PromotionEvidence
  polar_evidence: PolarHarnessPromotionEvidence
}

function allPassed(results: { passed: boolean }[]): boolean {
  return results.length > 0 && results.every(result => result.passed)
}

function targetFailureSliceImproved(
  slice: PromotionEvidenceSnapshot['target_failure_slice'],
): boolean {
  const delta = slice.after_success_rate - slice.before_success_rate
  const minDelta = slice.min_delta ?? 0
  return minDelta > 0 ? delta >= minDelta : delta > 0
}

function heldOutRegressionCount(snapshot: PromotionEvidenceSnapshot): number {
  const summaryCount = snapshot.held_out_summary?.regression_count ?? 0
  const resultCount = snapshot.held_out_results.filter(
    result => result.final_outcome === 'regression',
  ).length
  return Math.max(summaryCount, resultCount)
}

export function buildPromotionEvidenceFromSnapshot(
  snapshot: PromotionEvidenceSnapshot,
): PromotionEvidence {
  return {
    replay_passed: allPassed(snapshot.replay_results),
    held_out_passed: allPassed(snapshot.held_out_results),
    security_scan_passed: snapshot.security_scan.passed,
    complexity_budget_passed: snapshot.complexity_budget.passed,
    target_failure_slice_improved: targetFailureSliceImproved(
      snapshot.target_failure_slice,
    ),
    p0_p1_regressions: Math.max(
      snapshot.regressions.p0_p1_count,
      heldOutRegressionCount(snapshot),
    ),
    token_turn_cost_regression_pct:
      snapshot.complexity_budget.token_turn_cost_regression_pct,
  }
}

export function buildPolarHarnessPromotionEvidenceFromSnapshot(
  snapshot: PromotionEvidenceSnapshot,
): PolarHarnessPromotionEvidence {
  return {
    polar_spike_passed: snapshot.polar_spike?.passed ?? false,
    ...buildPromotionEvidenceFromSnapshot(snapshot),
  }
}

function readSnapshot(path: string): PromotionEvidenceSnapshot {
  return jsonParse(readFileSync(path, 'utf8')) as PromotionEvidenceSnapshot
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync_DEPRECATED(path, jsonStringify(value, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })
}

export function writePromotionEvidenceFromSnapshotFiles(
  input: WritePromotionEvidenceFromSnapshotFilesInput,
): WritePromotionEvidenceFromSnapshotFilesResult {
  const snapshot = readSnapshot(input.snapshot_path)
  const heuristic_evidence = buildPromotionEvidenceFromSnapshot(snapshot)
  const polar_evidence = buildPolarHarnessPromotionEvidenceFromSnapshot(snapshot)

  writeJson(input.heuristic_output_path, heuristic_evidence)
  writeJson(input.polar_output_path, polar_evidence)

  return {
    heuristic_output_path: input.heuristic_output_path,
    polar_output_path: input.polar_output_path,
    heuristic_evidence,
    polar_evidence,
  }
}
