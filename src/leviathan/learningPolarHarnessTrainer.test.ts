import { describe, expect, test } from 'bun:test'

import {
  trainPolarHarnessCandidates,
} from '../learning/polarHarnessTrainer.js'
import type { PolarProxySpikeObservation } from '../learning/polarProxySpike.js'

function observation(
  case_id: PolarProxySpikeObservation['case_id'],
  overrides: Partial<PolarProxySpikeObservation> = {},
): PolarProxySpikeObservation {
  return {
    case_id,
    captured_requests_count: 1,
    leviathan_model_requests_count: 1,
    request_response_pairs_complete: true,
    run_session_binding_complete: true,
    final_outcome_recorded: true,
    streaming_complete: true,
    tool_use_complete: true,
    trajectory_completeness: true,
    replay_fidelity: true,
    reward_binding_success: true,
    causal_chain_model_tool_diff_complete: true,
    test_artifacts_complete: true,
    ...overrides,
  }
}

describe('Leviathan Polar harness candidate trainer', () => {
  test('trains candidate Polar harness updates from failed spike observations without model updates', () => {
    const result = trainPolarHarnessCandidates({
      training_run_id: 'train_20260603_001',
      provider_model_id: 'mimo-v2.5',
      base_harness_version: 'git:abc123',
      observations: [
        observation('case_a_no_tool', {
          captured_requests_count: 0,
        }),
        observation('case_b_file_read_write', {
          tool_use_complete: false,
          causal_chain_model_tool_diff_complete: false,
        }),
        observation('case_c_test_execution', {
          reward_binding_success: false,
        }),
      ],
    })

    expect(result).toEqual({
      schema_version: 'leviathan.polar_harness_training.v1',
      status: 'candidate_only',
      training_run_id: 'train_20260603_001',
      provider_model_id: 'mimo-v2.5',
      provider_model_update: 'none',
      base_harness_version: 'git:abc123',
      candidate_harness_version: 'polar:candidate/train_20260603_001',
      stable_promotions_allowed: false,
      trained_failure_attributions: [
        'proxy_bypass',
        'tool_alignment_break',
        'reward_binding_break',
      ],
      updates: [
        {
          id: 'polar_candidate_proxy_bypass_001',
          status: 'candidate',
          failure_attribution: 'proxy_bypass',
          target_harness_asset: 'model_request_capture',
          source_cases: ['case_a_no_tool'],
          feature_flag: 'polar.candidate.proxy_bypass_001',
          rollback_plan: 'Disable feature flag polar.candidate.proxy_bypass_001',
        },
        {
          id: 'polar_candidate_tool_alignment_break_001',
          status: 'candidate',
          failure_attribution: 'tool_alignment_break',
          target_harness_asset: 'tool_trace_alignment',
          source_cases: ['case_b_file_read_write'],
          feature_flag: 'polar.candidate.tool_alignment_break_001',
          rollback_plan:
            'Disable feature flag polar.candidate.tool_alignment_break_001',
        },
        {
          id: 'polar_candidate_reward_binding_break_001',
          status: 'candidate',
          failure_attribution: 'reward_binding_break',
          target_harness_asset: 'reward_binding',
          source_cases: ['case_c_test_execution'],
          feature_flag: 'polar.candidate.reward_binding_break_001',
          rollback_plan:
            'Disable feature flag polar.candidate.reward_binding_break_001',
        },
      ],
      blocked_reasons: [],
    })
  })

  test('blocks Polar candidate training when spike observations all pass', () => {
    const result = trainPolarHarnessCandidates({
      training_run_id: 'train_clean',
      provider_model_id: 'mimo-v2.5',
      base_harness_version: 'git:abc123',
      observations: [
        observation('case_a_no_tool'),
        observation('case_b_file_read_write'),
        observation('case_c_test_execution'),
      ],
    })

    expect(result.status).toBe('blocked')
    expect(result.provider_model_update).toBe('none')
    expect(result.stable_promotions_allowed).toBe(false)
    expect(result.updates).toEqual([])
    expect(result.blocked_reasons).toEqual([
      'polar_spike.no_failed_observations',
    ])
  })
})
