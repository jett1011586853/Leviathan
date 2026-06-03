import type {
  PolarHarnessAsset,
  PolarHarnessCandidateUpdate,
} from './polarHarnessTrainer.js'
import type { PolarProxySpikeFailureAttribution } from './polarProxySpike.js'

export type PolarHarnessPromotionEvidence = {
  polar_spike_passed: boolean
  replay_passed: boolean
  held_out_passed: boolean
  security_scan_passed: boolean
  complexity_budget_passed: boolean
  target_failure_slice_improved: boolean
  p0_p1_regressions: number
  token_turn_cost_regression_pct: number
}

export type PolarHarnessPromotionDecision = {
  decision: 'promote' | 'reject'
  stable_allowed: boolean
  reasons: string[]
}

const POLAR_FAILURE_ATTRIBUTIONS: PolarProxySpikeFailureAttribution[] = [
  'proxy_bypass',
  'stream_truncation',
  'provider_mismatch',
  'tool_alignment_break',
  'reward_binding_break',
  'missing_case',
]

const POLAR_HARNESS_ASSETS: PolarHarnessAsset[] = [
  'model_request_capture',
  'streaming_capture',
  'provider_binding',
  'tool_trace_alignment',
  'reward_binding',
]

function hasText(value: string): boolean {
  return value.trim().length > 0
}

export function evaluatePolarHarnessPromotionUpdate(
  update: PolarHarnessCandidateUpdate,
  evidence: PolarHarnessPromotionEvidence,
): PolarHarnessPromotionDecision {
  const reasons: string[] = []

  if (update.status !== 'candidate') reasons.push('update.status')
  if (!hasText(update.id)) reasons.push('update.id')
  if (!POLAR_FAILURE_ATTRIBUTIONS.includes(update.failure_attribution)) {
    reasons.push('update.failure_attribution')
  }
  if (!POLAR_HARNESS_ASSETS.includes(update.target_harness_asset)) {
    reasons.push('update.target_harness_asset')
  }
  if (!update.source_cases.length) reasons.push('update.source_cases')
  if (!hasText(update.feature_flag)) reasons.push('update.feature_flag')
  if (!hasText(update.rollback_plan)) reasons.push('update.rollback_plan')

  if (!evidence.polar_spike_passed) {
    reasons.push('evidence.polar_spike_passed')
  }
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
