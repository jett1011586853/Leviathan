import {
  evaluatePolarProxySpike,
  type PolarProxySpikeCaseId,
  type PolarProxySpikeFailureAttribution,
  type PolarProxySpikeObservation,
} from './polarProxySpike.js'

export const POLAR_HARNESS_TRAINING_SCHEMA_VERSION =
  'leviathan.polar_harness_training.v1' as const

export type PolarHarnessAsset =
  | 'model_request_capture'
  | 'streaming_capture'
  | 'provider_binding'
  | 'tool_trace_alignment'
  | 'reward_binding'

export type PolarHarnessCandidateUpdate = {
  id: string
  status: 'candidate'
  failure_attribution: PolarProxySpikeFailureAttribution
  target_harness_asset: PolarHarnessAsset
  source_cases: PolarProxySpikeCaseId[]
  feature_flag: string
  rollback_plan: string
}

export type PolarHarnessTrainingInput = {
  training_run_id: string
  provider_model_id: string
  base_harness_version: string
  observations: PolarProxySpikeObservation[]
}

export type PolarHarnessTrainingResult = {
  schema_version: typeof POLAR_HARNESS_TRAINING_SCHEMA_VERSION
  status: 'candidate_only' | 'blocked'
  training_run_id: string
  provider_model_id: string
  provider_model_update: 'none'
  base_harness_version: string
  candidate_harness_version: string
  stable_promotions_allowed: false
  trained_failure_attributions: PolarProxySpikeFailureAttribution[]
  updates: PolarHarnessCandidateUpdate[]
  blocked_reasons: string[]
}

const ATTRIBUTION_TO_ASSET: Record<
  PolarProxySpikeFailureAttribution,
  PolarHarnessAsset
> = {
  proxy_bypass: 'model_request_capture',
  stream_truncation: 'streaming_capture',
  provider_mismatch: 'provider_binding',
  tool_alignment_break: 'tool_trace_alignment',
  reward_binding_break: 'reward_binding',
  missing_case: 'provider_binding',
}

function groupFailureCases(
  observations: PolarProxySpikeObservation[],
): Map<PolarProxySpikeFailureAttribution, PolarProxySpikeCaseId[]> {
  const spikeResult = evaluatePolarProxySpike(observations)
  const grouped = new Map<
    PolarProxySpikeFailureAttribution,
    PolarProxySpikeCaseId[]
  >()

  for (const failure of spikeResult.failures) {
    const cases = grouped.get(failure.failure_attribution) ?? []
    if (!cases.includes(failure.case_id)) cases.push(failure.case_id)
    grouped.set(failure.failure_attribution, cases)
  }

  for (const missingCase of spikeResult.missing_cases) {
    const cases = grouped.get('missing_case') ?? []
    if (!cases.includes(missingCase)) cases.push(missingCase)
    grouped.set('missing_case', cases)
  }

  return grouped
}

function candidateUpdate(
  attribution: PolarProxySpikeFailureAttribution,
  sourceCases: PolarProxySpikeCaseId[],
): PolarHarnessCandidateUpdate {
  const featureFlag = `polar.candidate.${attribution}_001`
  return {
    id: `polar_candidate_${attribution}_001`,
    status: 'candidate',
    failure_attribution: attribution,
    target_harness_asset: ATTRIBUTION_TO_ASSET[attribution],
    source_cases: sourceCases,
    feature_flag: featureFlag,
    rollback_plan: `Disable feature flag ${featureFlag}`,
  }
}

export function trainPolarHarnessCandidates(
  input: PolarHarnessTrainingInput,
): PolarHarnessTrainingResult {
  const grouped = groupFailureCases(input.observations)
  const trained_failure_attributions = [...grouped.keys()]
  const updates = trained_failure_attributions.map(attribution =>
    candidateUpdate(attribution, grouped.get(attribution) ?? []),
  )
  const blocked_reasons =
    updates.length === 0 ? ['polar_spike.no_failed_observations'] : []

  return {
    schema_version: POLAR_HARNESS_TRAINING_SCHEMA_VERSION,
    status: updates.length > 0 ? 'candidate_only' : 'blocked',
    training_run_id: input.training_run_id,
    provider_model_id: input.provider_model_id,
    provider_model_update: 'none',
    base_harness_version: input.base_harness_version,
    candidate_harness_version: `polar:candidate/${input.training_run_id}`,
    stable_promotions_allowed: false,
    trained_failure_attributions,
    updates,
    blocked_reasons,
  }
}
