import { describe, expect, test } from 'bun:test'

import {
  evaluateSparseOutcomeReward,
  validateRewardDesign,
} from '../learning/rewardDesign.js'
import { createEmptyRolloutBundle } from '../learning/rolloutSchema.js'

function rollout() {
  return createEmptyRolloutBundle({
    runId: 'run_reward',
    sessionId: 'session_reward',
    taskId: 'task_reward',
    source: 'internal',
    split: 'shadow',
    timestamp: '2026-06-03T00:00:00.000Z',
    harnessVersion: 'git:abc123',
    heuristicBundleVersion: 'hb:initial',
    policyVersion: 'mimo-v2.5',
    userInstruction: 'reward this run',
    repo: 'leviathan',
    baseCommit: 'abc123',
    cwdAlias: '$WORKDIR',
  })
}

describe('Leviathan sparse outcome reward design', () => {
  test('returns reward 1 only for resolved runs without regressions', () => {
    const bundle = rollout()
    bundle.evaluation.final_outcome = 'resolved'
    bundle.evaluation.resolved_label = true
    bundle.evaluation.exit_codes = [0]

    expect(evaluateSparseOutcomeReward(bundle)).toEqual({
      reward: 1,
      reason: 'resolved_without_regression',
    })
  })

  test('returns reward 0 for unresolved, timeout, or regression outcomes', () => {
    const unresolved = rollout()
    unresolved.evaluation.final_outcome = 'unresolved'

    const timeout = rollout()
    timeout.failure.taxonomy = ['execution_environment_failure.timeout']

    const regression = rollout()
    regression.evaluation.final_outcome = 'resolved'
    regression.evaluation.exit_codes = [0, 1]

    expect(evaluateSparseOutcomeReward(unresolved)).toEqual({
      reward: 0,
      reason: 'unresolved',
    })
    expect(evaluateSparseOutcomeReward(timeout)).toEqual({
      reward: 0,
      reason: 'timeout',
    })
    expect(evaluateSparseOutcomeReward(regression)).toEqual({
      reward: 0,
      reason: 'regression_detected',
    })
  })

  test('accepts only sparse outcome reward before formal training starts', () => {
    expect(
      validateRewardDesign({
        mode: 'sparse_outcome',
        reward_range: [0, 1],
        uses_trace_shaping: false,
        broadcasts_session_reward_to_requests: false,
      }),
    ).toEqual({
      valid: true,
      reasons: [],
    })

    expect(
      validateRewardDesign({
        mode: 'dense_shaping',
        reward_range: [-1, 1],
        uses_trace_shaping: true,
        broadcasts_session_reward_to_requests: true,
      }),
    ).toEqual({
      valid: false,
      reasons: [
        'mode',
        'reward_range',
        'uses_trace_shaping',
        'broadcasts_session_reward_to_requests',
      ],
    })
  })
})
