import type { LeviathanRolloutBundle } from './rolloutSchema.js'

export type SparseOutcomeReward = {
  reward: 0 | 1
  reason:
    | 'resolved_without_regression'
    | 'unresolved'
    | 'timeout'
    | 'regression_detected'
}

export type RewardDesign = {
  mode: 'sparse_outcome' | 'dense_shaping' | 'trace_reward'
  reward_range: [number, number]
  uses_trace_shaping: boolean
  broadcasts_session_reward_to_requests: boolean
}

export type RewardDesignValidation = {
  valid: boolean
  reasons: string[]
}

function hasTimeoutFailure(bundle: LeviathanRolloutBundle): boolean {
  return bundle.failure.taxonomy.some(code => code.includes('timeout'))
}

function hasRegression(bundle: LeviathanRolloutBundle): boolean {
  return bundle.evaluation.exit_codes.some(code => code !== 0)
}

export function evaluateSparseOutcomeReward(
  bundle: LeviathanRolloutBundle,
): SparseOutcomeReward {
  if (hasTimeoutFailure(bundle)) {
    return { reward: 0, reason: 'timeout' }
  }
  if (
    bundle.evaluation.final_outcome !== 'resolved' ||
    bundle.evaluation.resolved_label === false
  ) {
    return { reward: 0, reason: 'unresolved' }
  }
  if (hasRegression(bundle)) {
    return { reward: 0, reason: 'regression_detected' }
  }
  return { reward: 1, reason: 'resolved_without_regression' }
}

export function validateRewardDesign(
  design: RewardDesign,
): RewardDesignValidation {
  const reasons: string[] = []

  if (design.mode !== 'sparse_outcome') reasons.push('mode')
  if (design.reward_range[0] !== 0 || design.reward_range[1] !== 1) {
    reasons.push('reward_range')
  }
  if (design.uses_trace_shaping) reasons.push('uses_trace_shaping')
  if (design.broadcasts_session_reward_to_requests) {
    reasons.push('broadcasts_session_reward_to_requests')
  }

  return {
    valid: reasons.length === 0,
    reasons,
  }
}
