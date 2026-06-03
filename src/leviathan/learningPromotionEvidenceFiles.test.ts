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
  writePromotionEvidenceFromSnapshotFiles,
  type PromotionEvidenceSnapshot,
} from '../learning/promotionEvidenceFiles.js'

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-promotion-evidence-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function snapshot(
  overrides: Partial<PromotionEvidenceSnapshot> = {},
): PromotionEvidenceSnapshot {
  return {
    replay_results: [{ passed: true }],
    held_out_results: [{ passed: true }],
    security_scan: { passed: true },
    complexity_budget: {
      passed: true,
      token_turn_cost_regression_pct: 0.04,
    },
    target_failure_slice: {
      before_success_rate: 0.5,
      after_success_rate: 0.7,
      min_delta: 0.05,
    },
    regressions: { p0_p1_count: 0 },
    polar_spike: { passed: true },
    ...overrides,
  }
}

describe('Leviathan promotion evidence files', () => {
  test('writes heuristic and Polar promotion evidence from an evaluation snapshot', () => {
    withTempDir(dir => {
      const snapshotPath = join(dir, 'promotion-snapshot.json')
      const heuristicPath = join(dir, 'heuristic-evidence.json')
      const polarPath = join(dir, 'polar-evidence.json')
      writeFileSync(snapshotPath, JSON.stringify(snapshot()), 'utf8')

      const result = writePromotionEvidenceFromSnapshotFiles({
        snapshot_path: snapshotPath,
        heuristic_output_path: heuristicPath,
        polar_output_path: polarPath,
      })

      expect(result.heuristic_output_path).toBe(heuristicPath)
      expect(result.polar_output_path).toBe(polarPath)
      expect(result.heuristic_evidence).toEqual({
        replay_passed: true,
        held_out_passed: true,
        security_scan_passed: true,
        complexity_budget_passed: true,
        target_failure_slice_improved: true,
        p0_p1_regressions: 0,
        token_turn_cost_regression_pct: 0.04,
      })
      expect(result.polar_evidence).toEqual({
        polar_spike_passed: true,
        replay_passed: true,
        held_out_passed: true,
        security_scan_passed: true,
        complexity_budget_passed: true,
        target_failure_slice_improved: true,
        p0_p1_regressions: 0,
        token_turn_cost_regression_pct: 0.04,
      })
      expect(JSON.parse(readFileSync(heuristicPath, 'utf8'))).toEqual(
        result.heuristic_evidence,
      )
      expect(JSON.parse(readFileSync(polarPath, 'utf8'))).toEqual(
        result.polar_evidence,
      )
    })
  })

  test('keeps promotion evidence false when required evaluation gates are missing or regressed', () => {
    withTempDir(dir => {
      const snapshotPath = join(dir, 'promotion-snapshot.json')
      const heuristicPath = join(dir, 'heuristic-evidence.json')
      const polarPath = join(dir, 'polar-evidence.json')
      writeFileSync(
        snapshotPath,
        JSON.stringify(
          snapshot({
            replay_results: [],
            held_out_results: [{ passed: false }],
            security_scan: { passed: false },
            target_failure_slice: {
              before_success_rate: 0.5,
              after_success_rate: 0.51,
              min_delta: 0.05,
            },
            regressions: { p0_p1_count: 1 },
            polar_spike: { passed: false },
          }),
        ),
        'utf8',
      )

      const result = writePromotionEvidenceFromSnapshotFiles({
        snapshot_path: snapshotPath,
        heuristic_output_path: heuristicPath,
        polar_output_path: polarPath,
      })

      expect(result.heuristic_evidence).toMatchObject({
        replay_passed: false,
        held_out_passed: false,
        security_scan_passed: false,
        target_failure_slice_improved: false,
        p0_p1_regressions: 1,
      })
      expect(result.polar_evidence.polar_spike_passed).toBe(false)
    })
  })
})
