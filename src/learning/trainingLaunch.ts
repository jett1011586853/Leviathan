import {
  validateBaselineMatrix,
  type BaselineExperimentArmId,
  type BaselineMatrixInput,
  type PolicyTrainability,
} from './baselineMatrix.js'
import {
  evaluateTrainingReadiness,
  type TrainingReadinessCheckId,
  type TrainingReadinessEvidence,
} from './trainingReadiness.js'

export type TrainingLaunchRequest = {
  mode: 'formal'
  provider_model_id: string
  policy_trainability: PolicyTrainability
  readiness_evidence: TrainingReadinessEvidence
  baseline_matrix: BaselineMatrixInput
  rollout_bundle_count: number
}

export type TrainingStage =
  | 'collect_redacted_rollouts'
  | 'run_deterministic_replay'
  | 'train_candidate_heuristics'
  | 'run_polar_harness_update'
  | 'evaluate_four_arm_matrix'
  | 'promote_candidate_only'

export type TrainingLaunchPlan = {
  mode: 'hl_polar_harness_learning'
  provider_model_id: string
  provider_model_update: 'none'
  policy_trainability: PolicyTrainability
  enabled_arms: BaselineExperimentArmId[]
  rollout_bundle_count: number
  stages: TrainingStage[]
}

export type TrainingLaunchDecision =
  | {
      status: 'blocked'
      training_started: false
      failed_checks: TrainingReadinessCheckId[]
      reasons: string[]
    }
  | {
      status: 'ready'
      training_started: true
      failed_checks: []
      plan: TrainingLaunchPlan
    }

function addFailedCheck(
  checks: TrainingReadinessCheckId[],
  check: TrainingReadinessCheckId,
): void {
  if (!checks.includes(check)) checks.push(check)
}

function baselineReasons(input: BaselineMatrixInput): string[] {
  const result = validateBaselineMatrix(input)
  const reasons: string[] = []

  if (result.missing_arms.length > 0) {
    reasons.push(`baseline_matrix.missing_arms.${result.missing_arms.join(',')}`)
  }
  if (result.invalid_arms.length > 0) {
    reasons.push(`baseline_matrix.invalid_arms.${result.invalid_arms.join(',')}`)
  }

  return reasons
}

export function evaluateTrainingLaunch(
  request: TrainingLaunchRequest,
): TrainingLaunchDecision {
  const readiness = evaluateTrainingReadiness(request.readiness_evidence)
  const failed_checks = [...readiness.failed]
  const reasons = readiness.failed.map(check => `readiness.${check}`)
  const matrixReasons = baselineReasons(request.baseline_matrix)

  if (matrixReasons.length > 0) {
    addFailedCheck(failed_checks, 'baseline_matrix_fixed')
    reasons.push(...matrixReasons)
  }

  if (failed_checks.length > 0 || reasons.length > 0) {
    return {
      status: 'blocked',
      training_started: false,
      failed_checks,
      reasons,
    }
  }

  return {
    status: 'ready',
    training_started: true,
    failed_checks: [],
    plan: {
      mode: 'hl_polar_harness_learning',
      provider_model_id: request.provider_model_id,
      provider_model_update: 'none',
      policy_trainability: request.policy_trainability,
      enabled_arms: request.baseline_matrix.enabled_arms,
      rollout_bundle_count: request.rollout_bundle_count,
      stages: [
        'collect_redacted_rollouts',
        'run_deterministic_replay',
        'train_candidate_heuristics',
        'run_polar_harness_update',
        'evaluate_four_arm_matrix',
        'promote_candidate_only',
      ],
    },
  }
}
