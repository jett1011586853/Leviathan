import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  evaluatePolarProxySpike,
  type PolarProxySpikeObservation,
} from './polarProxySpike.js'
import type {
  HeldOutEvaluationResult,
  HeldOutEvaluationSummary,
  PromotionEvidenceSnapshot,
} from './promotionEvidenceFiles.js'
import { evaluateSparseOutcomeReward } from './rewardDesign.js'
import type { LeviathanRolloutBundle } from './rolloutSchema.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export type WriteEvaluationSnapshotFromFilesInput = {
  output_path: string
  replay_results_path: string
  held_out_rollout_paths: string[]
  security_scan_path: string
  complexity_budget_path: string
  target_failure_slice_path: string
  regressions_path: string
  polar_spike_observations_path: string
}

export type WriteEvaluationSnapshotFromFilesResult = {
  output_path: string
  snapshot: PromotionEvidenceSnapshot
}

type ReplayResultLike =
  | { passed: boolean }
  | { compare?: { passed?: boolean } }
  | { status?: string; compare?: { passed?: boolean } }

function readJson(path: string): unknown {
  return jsonParse(readFileSync(path, 'utf8')) as unknown
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value]
}

function replayPassed(value: ReplayResultLike): boolean {
  if ('passed' in value && typeof value.passed === 'boolean') {
    return value.passed
  }
  if (value.compare && typeof value.compare.passed === 'boolean') {
    return value.compare.passed
  }
  return false
}

function readReplayResults(path: string): { passed: boolean }[] {
  return asArray(readJson(path)).map(value => ({
    passed: replayPassed(value as ReplayResultLike),
  }))
}

function readRollout(path: string): LeviathanRolloutBundle {
  return readJson(path) as LeviathanRolloutBundle
}

function heldOutSplitLabel(bundle: LeviathanRolloutBundle): string {
  return bundle.run.split === 'test' ? 'held_out' : bundle.run.split
}

function readHeldOutResults(paths: string[]): HeldOutEvaluationResult[] {
  return paths.map(path => {
    const bundle = readRollout(path)
    return {
      passed: evaluateSparseOutcomeReward(bundle).reward === 1,
      task_id: bundle.run.task_id,
      split: heldOutSplitLabel(bundle),
      final_outcome: bundle.evaluation.final_outcome,
      resolved_label: bundle.evaluation.resolved_label,
      taxonomy: [...bundle.failure.taxonomy],
      exit_codes: [...bundle.evaluation.exit_codes],
      test_commands: [...bundle.evaluation.test_commands],
      test_outputs_count: bundle.evaluation.test_outputs.length,
      changed_files: [...bundle.code_changes.changed_files],
      root_cause_summary: bundle.failure.root_cause_summary,
    }
  })
}

function summarizeHeldOutResults(
  results: HeldOutEvaluationResult[],
): HeldOutEvaluationSummary {
  const by_taxonomy: Record<string, number> = {}
  let regression_count = 0
  let unresolved_count = 0
  let unknown_count = 0
  let passed = 0

  for (const result of results) {
    if (result.passed) passed += 1
    if (result.final_outcome === 'regression') regression_count += 1
    if (result.final_outcome === 'unresolved') unresolved_count += 1
    if (result.final_outcome === 'unknown') unknown_count += 1
    for (const taxonomy of result.taxonomy) {
      by_taxonomy[taxonomy] = (by_taxonomy[taxonomy] ?? 0) + 1
    }
  }

  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    regression_count,
    unresolved_count,
    unknown_count,
    by_taxonomy,
  }
}

function readPolarSpike(path: string): { passed: boolean } {
  const observations = asArray(readJson(path)) as PolarProxySpikeObservation[]
  return {
    passed: evaluatePolarProxySpike(observations).passed,
  }
}

export function buildEvaluationSnapshotFromFiles(
  input: WriteEvaluationSnapshotFromFilesInput,
): PromotionEvidenceSnapshot {
  const heldOutResults = readHeldOutResults(input.held_out_rollout_paths)
  return {
    replay_results: readReplayResults(input.replay_results_path),
    held_out_results: heldOutResults,
    held_out_summary: summarizeHeldOutResults(heldOutResults),
    security_scan: readJson(input.security_scan_path) as { passed: boolean },
    complexity_budget: readJson(input.complexity_budget_path) as {
      passed: boolean
      token_turn_cost_regression_pct: number
    },
    target_failure_slice: readJson(input.target_failure_slice_path) as {
      before_success_rate: number
      after_success_rate: number
      min_delta?: number
    },
    regressions: readJson(input.regressions_path) as { p0_p1_count: number },
    polar_spike: readPolarSpike(input.polar_spike_observations_path),
  }
}

export function writeEvaluationSnapshotFromFiles(
  input: WriteEvaluationSnapshotFromFilesInput,
): WriteEvaluationSnapshotFromFilesResult {
  const snapshot = buildEvaluationSnapshotFromFiles(input)

  mkdirSync(dirname(input.output_path), { recursive: true })
  writeFileSync_DEPRECATED(input.output_path, jsonStringify(snapshot, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })

  return {
    output_path: input.output_path,
    snapshot,
  }
}
