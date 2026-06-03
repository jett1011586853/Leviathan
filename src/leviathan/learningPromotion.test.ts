import { describe, expect, test } from 'bun:test'

import {
  evaluatePromotionCandidate,
  type HeuristicCandidate,
  type PromotionEvidence,
} from '../learning/promotionGate.js'

function createCandidate(): HeuristicCandidate {
  return {
    id: 'candidate_prompt_policy_001',
    type: 'candidate prompt policy',
    status: 'candidate',
    source_failure_taxonomy: ['tool_choice_failure'],
    feature_flag: 'hl.prompt_policy.candidate_001',
    rollback_plan: 'Disable feature flag hl.prompt_policy.candidate_001',
  }
}

function createPassingEvidence(): PromotionEvidence {
  return {
    replay_passed: true,
    held_out_passed: true,
    security_scan_passed: true,
    complexity_budget_passed: true,
    target_failure_slice_improved: true,
    p0_p1_regressions: 0,
    token_turn_cost_regression_pct: 0.05,
  }
}

describe('Leviathan heuristic promotion gate', () => {
  test('allows stable promotion only when all hard gates pass', () => {
    const result = evaluatePromotionCandidate(
      createCandidate(),
      createPassingEvidence(),
    )

    expect(result.decision).toBe('promote')
    expect(result.stable_allowed).toBe(true)
    expect(result.reasons).toEqual([])
  })

  test('rejects non-candidate updater output and unsafe evidence', () => {
    const result = evaluatePromotionCandidate(
      {
        ...createCandidate(),
        status: 'stable' as never,
        feature_flag: '',
        rollback_plan: '',
      },
      {
        ...createPassingEvidence(),
        replay_passed: false,
        security_scan_passed: false,
        p0_p1_regressions: 1,
        token_turn_cost_regression_pct: 0.25,
      },
    )

    expect(result.decision).toBe('reject')
    expect(result.stable_allowed).toBe(false)
    expect(result.reasons).toContain('candidate.status')
    expect(result.reasons).toContain('candidate.feature_flag')
    expect(result.reasons).toContain('candidate.rollback_plan')
    expect(result.reasons).toContain('evidence.replay_passed')
    expect(result.reasons).toContain('evidence.security_scan_passed')
    expect(result.reasons).toContain('evidence.p0_p1_regressions')
    expect(result.reasons).toContain('evidence.token_turn_cost_regression_pct')
  })
})
