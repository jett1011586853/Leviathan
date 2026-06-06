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
  writeHeuristicPromotionReportFromFiles,
} from '../learning/promotionFiles.js'
import type { HeuristicTrainingResult } from '../learning/heuristicTrainer.js'
import type { PromotionEvidence } from '../learning/promotionGate.js'

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-promotion-files-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function training(
  overrides: Partial<HeuristicTrainingResult> = {},
): HeuristicTrainingResult {
  return {
    schema_version: 'leviathan.heuristic_training.v1',
    status: 'candidate_only',
    training_run_id: 'train_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    base_heuristic_bundle_version: 'hb:initial',
    candidate_heuristic_bundle_version: 'hb:candidate/train_1',
    stable_promotions_allowed: false,
    trained_failure_classes: ['tool_choice_failure'],
    candidates: [
      {
        id: 'candidate_tool_choice_failure_001',
        type: 'candidate tool policy',
        status: 'candidate',
        source_failure_taxonomy: ['tool_choice_failure.tool_unavailable'],
        learned_guidance: [
          'Verify the selected tool exists before emitting a tool call.',
        ],
        feature_flag: 'hl.candidate.tool_choice_failure_001',
        rollback_plan:
          'Disable feature flag hl.candidate.tool_choice_failure_001',
      },
    ],
    blocked_reasons: [],
    ...overrides,
  }
}

function passingEvidence(
  overrides: Partial<PromotionEvidence> = {},
): PromotionEvidence {
  return {
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

describe('Leviathan heuristic promotion file report', () => {
  test('writes stable promotion decisions from candidate training and evidence files', () => {
    withTempDir(dir => {
      const trainingPath = join(dir, 'heuristic-candidates.json')
      const evidencePath = join(dir, 'promotion-evidence.json')
      const outputPath = join(dir, 'promotion-report.json')
      writeFileSync(trainingPath, JSON.stringify(training()), 'utf8')
      writeFileSync(evidencePath, JSON.stringify(passingEvidence()), 'utf8')

      const result = writeHeuristicPromotionReportFromFiles({
        training_path: trainingPath,
        evidence_path: evidencePath,
        output_path: outputPath,
      })

      expect(result.output_path).toBe(outputPath)
      expect(result.report).toEqual({
        schema_version: 'leviathan.heuristic_promotion_report.v1',
        status: 'ready_for_stable_promotion',
        training_run_id: 'train_1',
        provider_model_id: 'mimo-v2.5',
        provider_model_update: 'none',
        source_candidate_bundle_version: 'hb:candidate/train_1',
        stable_promotions_allowed: true,
        decisions: [
          {
            candidate_id: 'candidate_tool_choice_failure_001',
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

  test('writes rejected decisions when promotion evidence fails hard gates', () => {
    withTempDir(dir => {
      const trainingPath = join(dir, 'heuristic-candidates.json')
      const evidencePath = join(dir, 'promotion-evidence.json')
      const outputPath = join(dir, 'promotion-report.json')
      writeFileSync(trainingPath, JSON.stringify(training()), 'utf8')
      writeFileSync(
        evidencePath,
        JSON.stringify(
          passingEvidence({
            replay_passed: false,
            token_turn_cost_regression_pct: 0.25,
          }),
        ),
        'utf8',
      )

      const result = writeHeuristicPromotionReportFromFiles({
        training_path: trainingPath,
        evidence_path: evidencePath,
        output_path: outputPath,
      })

      expect(result.report.status).toBe('rejected')
      expect(result.report.stable_promotions_allowed).toBe(false)
      expect(result.report.decisions[0]?.decision).toBe('reject')
      expect(result.report.decisions[0]?.reasons).toEqual([
        'evidence.replay_passed',
        'evidence.token_turn_cost_regression_pct',
      ])
    })
  })

  test('blocks promotion reports when training output is not candidate-only', () => {
    withTempDir(dir => {
      const trainingPath = join(dir, 'heuristic-candidates.json')
      const evidencePath = join(dir, 'promotion-evidence.json')
      const outputPath = join(dir, 'promotion-report.json')
      writeFileSync(
        trainingPath,
        JSON.stringify(
          training({
            status: 'blocked',
            candidates: [],
            blocked_reasons: ['rollouts.no_trainable_failure_taxonomy'],
          }),
        ),
        'utf8',
      )
      writeFileSync(evidencePath, JSON.stringify(passingEvidence()), 'utf8')

      const result = writeHeuristicPromotionReportFromFiles({
        training_path: trainingPath,
        evidence_path: evidencePath,
        output_path: outputPath,
      })

      expect(result.report.status).toBe('blocked')
      expect(result.report.stable_promotions_allowed).toBe(false)
      expect(result.report.decisions).toEqual([])
      expect(result.report.blocked_reasons).toEqual([
        'training.status.blocked',
        'rollouts.no_trainable_failure_taxonomy',
      ])
    })
  })
})
