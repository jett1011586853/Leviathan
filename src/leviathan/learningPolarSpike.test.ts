import { describe, expect, test } from 'bun:test'

import {
  POLAR_PROXY_SPIKE_CASES,
  evaluatePolarProxySpike,
  type PolarProxySpikeObservation,
} from '../learning/polarProxySpike.js'

function passingObservation(
  case_id: PolarProxySpikeObservation['case_id'],
): PolarProxySpikeObservation {
  return {
    case_id,
    captured_requests_count: 2,
    leviathan_model_requests_count: 2,
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
  }
}

describe('Leviathan Polar proxy spike acceptance', () => {
  test('defines the v1.0 Case A, B and C spike cases', () => {
    expect(POLAR_PROXY_SPIKE_CASES.map(spikeCase => spikeCase.id)).toEqual([
      'case_a_no_tool',
      'case_b_file_read_write',
      'case_c_test_execution',
    ])
    expect(POLAR_PROXY_SPIKE_CASES.map(spikeCase => spikeCase.required_fields)).toEqual([
      [
        'captured_requests_count',
        'leviathan_model_requests_count',
        'request_response_pairs_complete',
        'run_session_binding_complete',
        'final_outcome_recorded',
      ],
      [
        'streaming_complete',
        'tool_use_complete',
        'trajectory_completeness',
        'replay_fidelity',
        'causal_chain_model_tool_diff_complete',
      ],
      [
        'test_artifacts_complete',
        'reward_binding_success',
        'trajectory_completeness',
        'replay_fidelity',
      ],
    ])
  })

  test('passes only when all three spike cases satisfy their acceptance criteria', () => {
    const result = evaluatePolarProxySpike([
      passingObservation('case_a_no_tool'),
      passingObservation('case_b_file_read_write'),
      passingObservation('case_c_test_execution'),
    ])

    expect(result.passed).toBe(true)
    expect(result.missing_cases).toEqual([])
    expect(result.failures).toEqual([])
  })

  test('fails Case A when proxy capture does not match Leviathan model requests', () => {
    const caseA = passingObservation('case_a_no_tool')
    caseA.captured_requests_count = 1

    const result = evaluatePolarProxySpike([
      caseA,
      passingObservation('case_b_file_read_write'),
      passingObservation('case_c_test_execution'),
    ])

    expect(result.passed).toBe(false)
    expect(result.failures).toEqual([
      {
        case_id: 'case_a_no_tool',
        reasons: ['captured_requests_count_mismatch'],
        failure_attribution: 'proxy_bypass',
      },
    ])
  })

  test('fails Case B when tool-use cannot be aligned to diff artifacts', () => {
    const caseB = passingObservation('case_b_file_read_write')
    caseB.tool_use_complete = false
    caseB.causal_chain_model_tool_diff_complete = false

    const result = evaluatePolarProxySpike([
      passingObservation('case_a_no_tool'),
      caseB,
      passingObservation('case_c_test_execution'),
    ])

    expect(result.passed).toBe(false)
    expect(result.failures).toEqual([
      {
        case_id: 'case_b_file_read_write',
        reasons: [
          'tool_use_complete',
          'causal_chain_model_tool_diff_complete',
        ],
        failure_attribution: 'tool_alignment_break',
      },
    ])
  })

  test('fails Case C when reward cannot be bound to the completed trajectory', () => {
    const caseC = passingObservation('case_c_test_execution')
    caseC.reward_binding_success = false

    const result = evaluatePolarProxySpike([
      passingObservation('case_a_no_tool'),
      passingObservation('case_b_file_read_write'),
      caseC,
    ])

    expect(result.passed).toBe(false)
    expect(result.failures).toEqual([
      {
        case_id: 'case_c_test_execution',
        reasons: ['reward_binding_success'],
        failure_attribution: 'reward_binding_break',
      },
    ])
  })

  test('fails when a required spike case is missing', () => {
    const result = evaluatePolarProxySpike([
      passingObservation('case_a_no_tool'),
      passingObservation('case_b_file_read_write'),
    ])

    expect(result.passed).toBe(false)
    expect(result.missing_cases).toEqual(['case_c_test_execution'])
  })
})
