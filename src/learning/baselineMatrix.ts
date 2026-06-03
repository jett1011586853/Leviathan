export type BaselineExperimentArmId =
  | 'baseline'
  | 'hl_only'
  | 'polar_only'
  | 'hl_polar'

export type PolicyTrainability = 'trainable' | 'closed_api'

export type BaselineExperimentArm = {
  id: BaselineExperimentArmId
  harness:
    | 'original'
    | 'leviathan'
    | 'leviathan_black_box'
    | 'leviathan_with_heuristics'
  heuristics: 'original' | 'upgraded'
  policy: 'original' | 'polar_trained'
  requires_trainable_policy: boolean
}

export type BaselineMatrixInput = {
  policy_trainability: PolicyTrainability
  enabled_arms: BaselineExperimentArmId[]
}

export type BaselineMatrixValidation = {
  valid: boolean
  missing_arms: BaselineExperimentArmId[]
  invalid_arms: BaselineExperimentArmId[]
  warnings: string[]
}

export const BASELINE_EXPERIMENT_ARMS: BaselineExperimentArm[] = [
  {
    id: 'baseline',
    harness: 'original',
    heuristics: 'original',
    policy: 'original',
    requires_trainable_policy: false,
  },
  {
    id: 'hl_only',
    harness: 'leviathan',
    heuristics: 'upgraded',
    policy: 'original',
    requires_trainable_policy: false,
  },
  {
    id: 'polar_only',
    harness: 'leviathan_black_box',
    heuristics: 'original',
    policy: 'polar_trained',
    requires_trainable_policy: true,
  },
  {
    id: 'hl_polar',
    harness: 'leviathan_with_heuristics',
    heuristics: 'upgraded',
    policy: 'polar_trained',
    requires_trainable_policy: true,
  },
]

const REQUIRED_TRAINABLE_ARMS: BaselineExperimentArmId[] = [
  'baseline',
  'hl_only',
  'polar_only',
  'hl_polar',
]

const REQUIRED_CLOSED_API_ARMS: BaselineExperimentArmId[] = [
  'baseline',
  'hl_only',
]

function armById(id: BaselineExperimentArmId): BaselineExperimentArm {
  const arm = BASELINE_EXPERIMENT_ARMS.find(candidate => candidate.id === id)
  if (!arm) throw new Error(`Unknown baseline arm: ${id}`)
  return arm
}

export function validateBaselineMatrix(
  input: BaselineMatrixInput,
): BaselineMatrixValidation {
  const required =
    input.policy_trainability === 'trainable'
      ? REQUIRED_TRAINABLE_ARMS
      : REQUIRED_CLOSED_API_ARMS
  const missing_arms = required.filter(arm => !input.enabled_arms.includes(arm))
  const invalid_arms =
    input.policy_trainability === 'closed_api'
      ? input.enabled_arms.filter(arm => armById(arm).requires_trainable_policy)
      : []
  const warnings: string[] = []

  if (input.policy_trainability === 'closed_api' && invalid_arms.length > 0) {
    warnings.push(
      'Closed API policies can use Polar instrumentation/evaluation, not parameter-training arms.',
    )
  } else if (input.policy_trainability === 'closed_api') {
    warnings.push('Closed API policy matrix omits Polar training arms by design.')
  }

  return {
    valid: missing_arms.length === 0 && invalid_arms.length === 0,
    missing_arms,
    invalid_arms,
    warnings,
  }
}
