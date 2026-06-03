import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  writePolarHarnessPromotionReportFromFiles,
} from '../learning/polarHarnessPromotionFiles.js'
import type { PolarHarnessTrainingResult } from '../learning/polarHarnessTrainer.js'
import type { PolarHarnessPromotionEvidence } from '../learning/polarHarnessPromotion.js'

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-polar-promotion-files-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function training(
  overrides: Partial<PolarHarnessTrainingResult> = {},
): PolarHarnessTrainingResult {
  return {
    schema_version: 'leviathan.polar_harness_training.v1',
    status: 'candidate_only',
    training_run_id: 'train_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    base_harness_version: 'git:abc123',
    candidate_harness_version: 'polar:candidate/train_1',
    stable_promotions_allowed: false,
    trained_failure_attributions: ['proxy_bypass'],
    updates: [
      {
        id: 'polar_candidate_proxy_bypass_001',
        status: 'candidate',
        failure_attribution: 'proxy_bypass',
        target_harness_asset: 'model_request_capture',
        source_cases: ['case_a_no_tool'],
        feature_flag: 'polar.candidate.proxy_bypass_001',
        rollback_plan:
          'Disable feature flag polar.candidate.proxy_bypass_001',
      },
    ],
    blocked_reasons: [],
    ...overrides,
  }
}

function evidence(
  overrides: Partial<PolarHarnessPromotionEvidence> = {},
): PolarHarnessPromotionEvidence {
  return {
    polar_spike_passed: true,
    replay_passed: true,
    held_out_passed: true,
    security_scan_passed: true,
    complexity_budget_passed: true,
    target_failure_slice_improved: true,
    p0_p1_regressions: 0,
    token_turn_cost_regression_pct: 0.04,
    ...overrides,
  }
}

describe('Leviathan Polar harness promotion file report', () => {
  test('writes stable promotion decisions from Polar training and evidence files', () => {
    withTempDir(dir => {
      const trainingPath = join(dir, 'polar-candidates.json')
      const evidencePath = join(dir, 'polar-promotion-evidence.json')
      const outputPath = join(dir, 'polar-promotion-report.json')
      writeFileSync(trainingPath, JSON.stringify(training()), 'utf8')
      writeFileSync(evidencePath, JSON.stringify(evidence()), 'utf8')

      const result = writePolarHarnessPromotionReportFromFiles({
        training_path: trainingPath,
        evidence_path: evidencePath,
        output_path: outputPath,
      })

      expect(result.output_path).toBe(outputPath)
      expect(result.report).toEqual({
        schema_version: 'leviathan.polar_harness_promotion_report.v1',
        status: 'ready_for_stable_promotion',
        training_run_id: 'train_1',
        provider_model_id: 'mimo-v2.5',
        provider_model_update: 'none',
        source_candidate_harness_version: 'polar:candidate/train_1',
        stable_promotions_allowed: true,
        decisions: [
          {
            update_id: 'polar_candidate_proxy_bypass_001',
            decision: 'promote',
            stable_allowed: true,
            reasons: [],
          },
        ],
        blocked_reasons: [],
      })
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(
        result.report,
      )
    })
  })

  test('writes rejected decisions when Polar promotion evidence fails hard gates', () => {
    withTempDir(dir => {
      const trainingPath = join(dir, 'polar-candidates.json')
      const evidencePath = join(dir, 'polar-promotion-evidence.json')
      const outputPath = join(dir, 'polar-promotion-report.json')
      writeFileSync(trainingPath, JSON.stringify(training()), 'utf8')
      writeFileSync(
        evidencePath,
        JSON.stringify(
          evidence({
            polar_spike_passed: false,
            token_turn_cost_regression_pct: 0.25,
          }),
        ),
        'utf8',
      )

      const result = writePolarHarnessPromotionReportFromFiles({
        training_path: trainingPath,
        evidence_path: evidencePath,
        output_path: outputPath,
      })

      expect(result.report.status).toBe('rejected')
      expect(result.report.stable_promotions_allowed).toBe(false)
      expect(result.report.decisions[0]?.decision).toBe('reject')
      expect(result.report.decisions[0]?.reasons).toEqual([
        'evidence.polar_spike_passed',
        'evidence.token_turn_cost_regression_pct',
      ])
    })
  })

  test('blocks promotion reports when Polar training output is blocked', () => {
    withTempDir(dir => {
      const trainingPath = join(dir, 'polar-candidates.json')
      const evidencePath = join(dir, 'polar-promotion-evidence.json')
      const outputPath = join(dir, 'polar-promotion-report.json')
      writeFileSync(
        trainingPath,
        JSON.stringify(
          training({
            status: 'blocked',
            updates: [],
            blocked_reasons: ['polar_spike.no_failed_observations'],
          }),
        ),
        'utf8',
      )
      writeFileSync(evidencePath, JSON.stringify(evidence()), 'utf8')

      const result = writePolarHarnessPromotionReportFromFiles({
        training_path: trainingPath,
        evidence_path: evidencePath,
        output_path: outputPath,
      })

      expect(result.report.status).toBe('blocked')
      expect(result.report.stable_promotions_allowed).toBe(false)
      expect(result.report.decisions).toEqual([])
      expect(result.report.blocked_reasons).toEqual([
        'training.status.blocked',
        'polar_spike.no_failed_observations',
      ])
    })
  })
})
