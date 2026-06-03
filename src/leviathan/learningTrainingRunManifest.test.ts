import { describe, expect, test } from 'bun:test'

import {
  createTrainingRunManifest,
  type TrainingRunManifestInput,
} from '../learning/trainingRunManifest.js'
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

function manifestInput(
  overrides: Partial<TrainingRunManifestInput> = {},
): TrainingRunManifestInput {
  return {
    run_id: 'train_20260603_001',
    created_at: '2026-06-03T12:00:00.000Z',
    cwd_alias: '$WORKDIR',
    git_commit: 'abc123',
    rollback_checkpoint_tag: 'checkpoint/hl-polar-readiness-foundation-v1.0',
    launch_decision: evaluateTrainingLaunch(launchRequest()),
    ...overrides,
  }
}

describe('Leviathan training run manifest', () => {
  test('materializes a ready launch as an auditable started harness-learning run', () => {
    expect(createTrainingRunManifest(manifestInput())).toEqual({
      schema_version: 'leviathan.training_run.v1',
      run_id: 'train_20260603_001',
      created_at: '2026-06-03T12:00:00.000Z',
      status: 'started',
      cwd_alias: '$WORKDIR',
      git_commit: 'abc123',
      rollback_checkpoint_tag: 'checkpoint/hl-polar-readiness-foundation-v1.0',
      launch: {
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
      blocked: null,
    })
  })

  test('records blocked launches without starting a training run', () => {
    const manifest = createTrainingRunManifest(
      manifestInput({
        launch_decision: evaluateTrainingLaunch(
          launchRequest({
            readiness_evidence: allReadyEvidence({
              benchmark_splits_isolated: false,
            }),
          }),
        ),
      }),
    )

    expect(manifest.status).toBe('blocked')
    expect(manifest.launch).toBe(null)
    expect(manifest.blocked).toEqual({
      failed_checks: ['benchmark_splits_isolated'],
      reasons: ['readiness.benchmark_splits_isolated'],
    })
  })
})
