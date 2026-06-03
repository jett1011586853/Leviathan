import { describe, expect, test } from 'bun:test'

import {
  evaluateTrainingLaunch,
  type TrainingLaunchRequest,
} from '../learning/trainingLaunch.js'
import {
  TRAINING_READINESS_CHECKS,
  type TrainingReadinessEvidence,
} from '../learning/trainingReadiness.js'

function allReadyEvidence(
  overrides: Partial<TrainingReadinessEvidence> = {},
): TrainingReadinessEvidence {
  return {
    ...(Object.fromEntries(
      TRAINING_READINESS_CHECKS.map(check => [check.id, true]),
    ) as TrainingReadinessEvidence),
    ...overrides,
  }
}

function launchRequest(
  overrides: Partial<TrainingLaunchRequest> = {},
): TrainingLaunchRequest {
  return {
    mode: 'formal',
    provider_model_id: 'mimo-v2.5',
    policy_trainability: 'closed_api',
    readiness_evidence: allReadyEvidence(),
    baseline_matrix: {
      policy_trainability: 'closed_api',
      enabled_arms: ['baseline', 'hl_only', 'polar_only', 'hl_polar'],
    },
    rollout_bundle_count: 128,
    ...overrides,
  }
}

describe('Leviathan HL + Polar training launch guard', () => {
  test('blocks formal training until every readiness gate has evidence', () => {
    const result = evaluateTrainingLaunch(
      launchRequest({
        readiness_evidence: allReadyEvidence({
          replay_runner_fixed_task_reproducible: false,
          rollback_and_incident_plan_ready: false,
        }),
      }),
    )

    expect(result).toEqual({
      status: 'blocked',
      training_started: false,
      failed_checks: [
        'replay_runner_fixed_task_reproducible',
        'rollback_and_incident_plan_ready',
      ],
      reasons: [
        'readiness.replay_runner_fixed_task_reproducible',
        'readiness.rollback_and_incident_plan_ready',
      ],
    })
  })

  test('blocks formal training when the baseline matrix is not the full four-arm matrix', () => {
    const result = evaluateTrainingLaunch(
      launchRequest({
        baseline_matrix: {
          policy_trainability: 'closed_api',
          enabled_arms: ['baseline', 'hl_only'],
        },
      }),
    )

    expect(result).toEqual({
      status: 'blocked',
      training_started: false,
      failed_checks: ['baseline_matrix_fixed'],
      reasons: ['baseline_matrix.missing_arms.polar_only,hl_polar'],
    })
  })

  test('creates a closed API HL + Polar harness learning plan without model parameter training', () => {
    const result = evaluateTrainingLaunch(launchRequest())

    expect(result).toEqual({
      status: 'ready',
      training_started: true,
      failed_checks: [],
      plan: {
        mode: 'hl_polar_harness_learning',
        provider_model_id: 'mimo-v2.5',
        provider_model_update: 'none',
        policy_trainability: 'closed_api',
        enabled_arms: ['baseline', 'hl_only', 'polar_only', 'hl_polar'],
        rollout_bundle_count: 128,
        stages: [
          'collect_redacted_rollouts',
          'run_deterministic_replay',
          'train_candidate_heuristics',
          'run_polar_harness_update',
          'evaluate_four_arm_matrix',
          'promote_candidate_only',
        ],
      },
    })
  })
})
