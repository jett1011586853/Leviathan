import type {
  CandidateHeuristicType,
  HeuristicCandidate,
} from './promotionGate.js'
import type { LeviathanRolloutBundle } from './rolloutSchema.js'

export const HEURISTIC_TRAINING_SCHEMA_VERSION =
  'leviathan.heuristic_training.v1' as const

export type HeuristicTrainingInput = {
  training_run_id: string
  provider_model_id: string
  base_heuristic_bundle_version: string
  rollouts: LeviathanRolloutBundle[]
}

export type HeuristicTrainingResult = {
  schema_version: typeof HEURISTIC_TRAINING_SCHEMA_VERSION
  status: 'candidate_only' | 'blocked'
  training_run_id: string
  provider_model_id: string
  provider_model_update: 'none'
  base_heuristic_bundle_version: string
  candidate_heuristic_bundle_version: string
  stable_promotions_allowed: false
  trained_failure_classes: string[]
  candidates: HeuristicCandidate[]
  blocked_reasons: string[]
}

const FAILURE_TO_CANDIDATE_TYPE: Record<string, CandidateHeuristicType> = {
  model_interaction_failure: 'candidate prompt policy',
  tool_choice_failure: 'candidate tool policy',
  execution_environment_failure: 'candidate recovery rule',
  code_modification_failure: 'candidate controller patch',
  verification_failure: 'candidate regression test',
  memory_context_failure: 'candidate memory',
  recovery_control_failure: 'candidate recovery rule',
  security_governance_failure: 'candidate controller patch',
}

function primaryFailureClass(taxonomy: string): string {
  return taxonomy.split('.')[0] ?? ''
}

function candidateForFailureClass(
  failureClass: string,
  sourceTaxonomy: string[],
): HeuristicCandidate {
  const featureFlag = `hl.candidate.${failureClass}_001`
  return {
    id: `candidate_${failureClass}_001`,
    type: FAILURE_TO_CANDIDATE_TYPE[failureClass]!,
    status: 'candidate',
    source_failure_taxonomy: sourceTaxonomy,
    feature_flag: featureFlag,
    rollback_plan: `Disable feature flag ${featureFlag}`,
  }
}

function groupTrainableTaxonomy(
  rollouts: LeviathanRolloutBundle[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>()

  for (const rollout of rollouts) {
    for (const taxonomy of rollout.failure.taxonomy) {
      const failureClass = primaryFailureClass(taxonomy)
      if (!FAILURE_TO_CANDIDATE_TYPE[failureClass]) continue
      const values = grouped.get(failureClass) ?? []
      if (!values.includes(taxonomy)) values.push(taxonomy)
      grouped.set(failureClass, values)
    }
  }

  return grouped
}

export function trainHeuristicCandidatesFromRollouts(
  input: HeuristicTrainingInput,
): HeuristicTrainingResult {
  const grouped = groupTrainableTaxonomy(input.rollouts)
  const trained_failure_classes = [...grouped.keys()]
  const candidates = trained_failure_classes.map(failureClass =>
    candidateForFailureClass(failureClass, grouped.get(failureClass) ?? []),
  )
  const blocked_reasons =
    candidates.length === 0 ? ['rollouts.no_trainable_failure_taxonomy'] : []

  return {
    schema_version: HEURISTIC_TRAINING_SCHEMA_VERSION,
    status: candidates.length > 0 ? 'candidate_only' : 'blocked',
    training_run_id: input.training_run_id,
    provider_model_id: input.provider_model_id,
    provider_model_update: 'none',
    base_heuristic_bundle_version: input.base_heuristic_bundle_version,
    candidate_heuristic_bundle_version: `hb:candidate/${input.training_run_id}`,
    stable_promotions_allowed: false,
    trained_failure_classes,
    candidates,
    blocked_reasons,
  }
}
