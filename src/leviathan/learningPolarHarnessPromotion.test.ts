import { describe, expect, test } from 'bun:test'

import {
  evaluatePolarHarnessPromotionUpdate,
  type PolarHarnessPromotionEvidence,
} from '../learning/polarHarnessPromotion.js'
import type { PolarHarnessCandidateUpdate } from '../learning/polarHarnessTrainer.js'

function update(
  overrides: Partial<PolarHarnessCandidateUpdate> = {},
): PolarHarnessCandidateUpdate {
  return {
    id: 'polar_candidate_proxy_bypass_001',
    status: 'candidate',
    failure_attribution: 'proxy_bypass',
    target_harness_asset: 'model_request_capture',
    source_cases: ['case_a_no_tool'],
    feature_flag: 'polar.candidate.proxy_bypass_001',
    rollback_plan: 'Disable feature flag polar.candidate.proxy_bypass_001',
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

describe('Leviathan Polar harness promotion gate', () => {
  test('allows stable promotion only when all Polar harness gates pass', () => {
    const result = evaluatePolarHarnessPromotionUpdate(update(), evidence())

    expect(result.decision).toBe('promote')
    expect(result.stable_allowed).toBe(true)
    expect(result.reasons).toEqual([])
  })

  test('rejects unsafe harness updates and failed Polar evidence', () => {
    const result = evaluatePolarHarnessPromotionUpdate(
      update({
        status: 'stable' as never,
        source_cases: [],
        feature_flag: '',
        rollback_plan: '',
      }),
      evidence({
        polar_spike_passed: false,
        target_failure_slice_improved: false,
        p0_p1_regressions: 1,
        token_turn_cost_regression_pct: 0.25,
      }),
    )

    expect(result.decision).toBe('reject')
    expect(result.stable_allowed).toBe(false)
    expect(result.reasons).toContain('update.status')
    expect(result.reasons).toContain('update.source_cases')
    expect(result.reasons).toContain('update.feature_flag')
    expect(result.reasons).toContain('update.rollback_plan')
    expect(result.reasons).toContain('evidence.polar_spike_passed')
    expect(result.reasons).toContain('evidence.target_failure_slice_improved')
    expect(result.reasons).toContain('evidence.p0_p1_regressions')
    expect(result.reasons).toContain('evidence.token_turn_cost_regression_pct')
  })
})
