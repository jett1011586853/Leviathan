export type PolarProxySpikeCaseId =
  | 'case_a_no_tool'
  | 'case_b_file_read_write'
  | 'case_c_test_execution'

export type PolarProxySpikeField =
  | 'captured_requests_count'
  | 'leviathan_model_requests_count'
  | 'request_response_pairs_complete'
  | 'run_session_binding_complete'
  | 'final_outcome_recorded'
  | 'streaming_complete'
  | 'tool_use_complete'
  | 'trajectory_completeness'
  | 'replay_fidelity'
  | 'reward_binding_success'
  | 'causal_chain_model_tool_diff_complete'
  | 'test_artifacts_complete'

export type PolarProxySpikeFailureAttribution =
  | 'proxy_bypass'
  | 'stream_truncation'
  | 'provider_mismatch'
  | 'tool_alignment_break'
  | 'reward_binding_break'
  | 'missing_case'

export type PolarProxySpikeCase = {
  id: PolarProxySpikeCaseId
  label: string
  required_fields: PolarProxySpikeField[]
}

export type PolarProxySpikeObservation = {
  case_id: PolarProxySpikeCaseId
  captured_requests_count: number
  leviathan_model_requests_count: number
  request_response_pairs_complete: boolean
  run_session_binding_complete: boolean
  final_outcome_recorded: boolean
  streaming_complete: boolean
  tool_use_complete: boolean
  trajectory_completeness: boolean
  replay_fidelity: boolean
  reward_binding_success: boolean
  causal_chain_model_tool_diff_complete: boolean
  test_artifacts_complete: boolean
}

export type PolarProxySpikeFailure = {
  case_id: PolarProxySpikeCaseId
  reasons: string[]
  failure_attribution: PolarProxySpikeFailureAttribution
}

export type PolarProxySpikeResult = {
  passed: boolean
  missing_cases: PolarProxySpikeCaseId[]
  failures: PolarProxySpikeFailure[]
}

export const POLAR_PROXY_SPIKE_CASES: PolarProxySpikeCase[] = [
  {
    id: 'case_a_no_tool',
    label: 'Case A: no-tool model request capture',
    required_fields: [
      'captured_requests_count',
      'leviathan_model_requests_count',
      'request_response_pairs_complete',
      'run_session_binding_complete',
      'final_outcome_recorded',
    ],
  },
  {
    id: 'case_b_file_read_write',
    label: 'Case B: file read/write tool-use alignment',
    required_fields: [
      'streaming_complete',
      'tool_use_complete',
      'trajectory_completeness',
      'replay_fidelity',
      'causal_chain_model_tool_diff_complete',
    ],
  },
  {
    id: 'case_c_test_execution',
    label: 'Case C: test execution reward binding',
    required_fields: [
      'test_artifacts_complete',
      'reward_binding_success',
      'trajectory_completeness',
      'replay_fidelity',
    ],
  },
]

function caseFailureAttribution(
  caseId: PolarProxySpikeCaseId,
  reasons: string[],
): PolarProxySpikeFailureAttribution {
  if (caseId === 'case_a_no_tool') return 'proxy_bypass'
  if (caseId === 'case_c_test_execution') return 'reward_binding_break'
  if (reasons.includes('streaming_complete')) return 'stream_truncation'
  if (
    reasons.includes('tool_use_complete') ||
    reasons.includes('causal_chain_model_tool_diff_complete')
  ) {
    return 'tool_alignment_break'
  }
  return 'provider_mismatch'
}

function evaluateCase(
  spikeCase: PolarProxySpikeCase,
  observation: PolarProxySpikeObservation,
): PolarProxySpikeFailure | null {
  const reasons: string[] = []

  if (
    spikeCase.id === 'case_a_no_tool' &&
    observation.captured_requests_count !==
      observation.leviathan_model_requests_count
  ) {
    reasons.push('captured_requests_count_mismatch')
  }

  for (const field of spikeCase.required_fields) {
    const value = observation[field]
    if (typeof value === 'boolean' && !value) {
      reasons.push(field)
    }
    if (typeof value === 'number' && value <= 0) {
      reasons.push(field)
    }
  }

  if (!reasons.length) return null
  return {
    case_id: spikeCase.id,
    reasons,
    failure_attribution: caseFailureAttribution(spikeCase.id, reasons),
  }
}

export function evaluatePolarProxySpike(
  observations: PolarProxySpikeObservation[],
): PolarProxySpikeResult {
  const byCase = new Map(
    observations.map(observation => [observation.case_id, observation]),
  )
  const missing_cases: PolarProxySpikeCaseId[] = []
  const failures: PolarProxySpikeFailure[] = []

  for (const spikeCase of POLAR_PROXY_SPIKE_CASES) {
    const observation = byCase.get(spikeCase.id)
    if (!observation) {
      missing_cases.push(spikeCase.id)
      continue
    }
    const failure = evaluateCase(spikeCase, observation)
    if (failure) failures.push(failure)
  }

  return {
    passed: missing_cases.length === 0 && failures.length === 0,
    missing_cases,
    failures,
  }
}
