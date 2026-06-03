export const CANDIDATE_HEURISTIC_TYPES = [
  'candidate prompt policy',
  'candidate tool policy',
  'candidate memory',
  'candidate recovery rule',
  'candidate regression test',
  'candidate context policy',
  'candidate controller patch',
] as const

export type CandidateHeuristicType = (typeof CANDIDATE_HEURISTIC_TYPES)[number]

export type HeuristicCandidate = {
  id: string
  type: CandidateHeuristicType
  status: 'candidate'
  source_failure_taxonomy: string[]
  feature_flag: string
  rollback_plan: string
}

export type PromotionEvidence = {
  replay_passed: boolean
  held_out_passed: boolean
  security_scan_passed: boolean
  complexity_budget_passed: boolean
  target_failure_slice_improved: boolean
  p0_p1_regressions: number
  token_turn_cost_regression_pct: number
}

export type PromotionDecision = {
  decision: 'promote' | 'reject'
  stable_allowed: boolean
  reasons: string[]
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}

export function evaluatePromotionCandidate(
  candidate: HeuristicCandidate,
  evidence: PromotionEvidence,
): PromotionDecision {
  const reasons: string[] = []

  if (candidate.status !== 'candidate') reasons.push('candidate.status')
  if (!hasText(candidate.id)) reasons.push('candidate.id')
  if (!CANDIDATE_HEURISTIC_TYPES.includes(candidate.type)) {
    reasons.push('candidate.type')
  }
  if (!candidate.source_failure_taxonomy.length) {
    reasons.push('candidate.source_failure_taxonomy')
  }
  if (!hasText(candidate.feature_flag)) reasons.push('candidate.feature_flag')
  if (!hasText(candidate.rollback_plan)) reasons.push('candidate.rollback_plan')

  if (!evidence.replay_passed) reasons.push('evidence.replay_passed')
  if (!evidence.held_out_passed) reasons.push('evidence.held_out_passed')
  if (!evidence.security_scan_passed) {
    reasons.push('evidence.security_scan_passed')
  }
  if (!evidence.complexity_budget_passed) {
    reasons.push('evidence.complexity_budget_passed')
  }
  if (!evidence.target_failure_slice_improved) {
    reasons.push('evidence.target_failure_slice_improved')
  }
  if (evidence.p0_p1_regressions !== 0) {
    reasons.push('evidence.p0_p1_regressions')
  }
  if (evidence.token_turn_cost_regression_pct > 0.1) {
    reasons.push('evidence.token_turn_cost_regression_pct')
  }

  return {
    decision: reasons.length === 0 ? 'promote' : 'reject',
    stable_allowed: reasons.length === 0,
    reasons,
  }
}
