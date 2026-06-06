import { describe, expect, test } from 'bun:test'

import {
  trainHeuristicCandidatesFromRollouts,
} from '../learning/heuristicTrainer.js'
import {
  createEmptyRolloutBundle,
  type RolloutSplit,
} from '../learning/rolloutSchema.js'

function rollout(
  id: string,
  taxonomy: string[],
  split: RolloutSplit = 'shadow',
  rootCause = `root cause for ${id}`,
) {
  const bundle = createEmptyRolloutBundle({
    runId: `run_${id}`,
    sessionId: `session_${id}`,
    taskId: `task_${id}`,
    source: 'internal',
    split,
    timestamp: '2026-06-03T00:00:00.000Z',
    harnessVersion: 'git:abc123',
    heuristicBundleVersion: 'hb:initial',
    policyVersion: 'mimo-v2.5',
    userInstruction: 'train candidate heuristics from rollouts',
    repo: 'leviathan',
    baseCommit: 'abc123',
    cwdAlias: '$WORKDIR',
  })
  bundle.failure.taxonomy = taxonomy
  bundle.failure.root_cause_summary = rootCause
  return bundle
}

describe('Leviathan candidate-only heuristic trainer', () => {
  test('trains candidate harness heuristics from rollout failure taxonomy without updating the provider model', () => {
    const result = trainHeuristicCandidatesFromRollouts({
      training_run_id: 'train_20260603_001',
      provider_model_id: 'mimo-v2.5',
      base_heuristic_bundle_version: 'hb:initial',
      rollouts: [
        rollout('1', ['tool_choice_failure.bad_args']),
        rollout('2', ['verification_failure.flaky_tests']),
        rollout('3', ['recovery_control_failure.no_retry']),
      ],
    })

    expect(result).toEqual({
      schema_version: 'leviathan.heuristic_training.v1',
      status: 'candidate_only',
      training_run_id: 'train_20260603_001',
      provider_model_id: 'mimo-v2.5',
      provider_model_update: 'none',
      base_heuristic_bundle_version: 'hb:initial',
      candidate_heuristic_bundle_version:
        'hb:candidate/train_20260603_001',
      stable_promotions_allowed: false,
      trained_failure_classes: [
        'tool_choice_failure',
        'verification_failure',
        'recovery_control_failure',
      ],
      candidates: [
        {
          id: 'candidate_tool_choice_failure_001',
          type: 'candidate tool policy',
          status: 'candidate',
          source_failure_taxonomy: ['tool_choice_failure.bad_args'],
          learned_guidance: [
            'Before emitting a tool call, verify the tool name is present in the current available tool set; if Glob, Read, or another familiar tool is unavailable, use an available equivalent instead of calling it.',
            'Validate required tool input fields and path arguments before the call; prefer confirmed cwd or repo-relative paths over unverified $WORKDIR placeholders.',
          ],
          feature_flag: 'hl.candidate.tool_choice_failure_001',
          rollback_plan: 'Disable feature flag hl.candidate.tool_choice_failure_001',
        },
        {
          id: 'candidate_verification_failure_001',
          type: 'candidate regression test',
          status: 'candidate',
          source_failure_taxonomy: ['verification_failure.flaky_tests'],
          learned_guidance: [
            'Run the smallest relevant verification command after a change and capture exit code plus failure output before claiming resolution.',
            'Separate pre-existing or flaky failures from regressions introduced by the current trajectory.',
          ],
          feature_flag: 'hl.candidate.verification_failure_001',
          rollback_plan:
            'Disable feature flag hl.candidate.verification_failure_001',
        },
        {
          id: 'candidate_recovery_control_failure_001',
          type: 'candidate recovery rule',
          status: 'candidate',
          source_failure_taxonomy: ['recovery_control_failure.no_retry'],
          learned_guidance: [
            'After a tool or command failure, inspect the concrete stderr, exit code, cwd, and previous tool input before retrying.',
            'Retry with a corrected plan once; avoid repeating the same failed command or tool input without new evidence.',
          ],
          feature_flag: 'hl.candidate.recovery_control_failure_001',
          rollback_plan:
            'Disable feature flag hl.candidate.recovery_control_failure_001',
        },
      ],
      blocked_reasons: [],
    })
  })

  test('blocks candidate training when rollouts do not contain trainable failure taxonomy', () => {
    const result = trainHeuristicCandidatesFromRollouts({
      training_run_id: 'train_empty',
      provider_model_id: 'mimo-v2.5',
      base_heuristic_bundle_version: 'hb:initial',
      rollouts: [
        rollout('1', []),
        rollout('2', ['unknown_failure.some_signal']),
      ],
    })

    expect(result.status).toBe('blocked')
    expect(result.provider_model_update).toBe('none')
    expect(result.stable_promotions_allowed).toBe(false)
    expect(result.candidates).toEqual([])
    expect(result.blocked_reasons).toEqual([
      'rollouts.no_trainable_failure_taxonomy',
    ])
  })

  test('blocks candidate training when final evaluation rollouts are included', () => {
    const result = trainHeuristicCandidatesFromRollouts({
      training_run_id: 'train_leak',
      provider_model_id: 'mimo-v2.5',
      base_heuristic_bundle_version: 'hb:initial',
      rollouts: [
        rollout('1', ['tool_choice_failure.bad_args'], 'train'),
        rollout('held', ['verification_failure.hidden_regression'], 'held_out'),
      ],
    })

    expect(result.status).toBe('blocked')
    expect(result.provider_model_update).toBe('none')
    expect(result.stable_promotions_allowed).toBe(false)
    expect(result.candidates).toEqual([])
    expect(result.blocked_reasons).toEqual([
      'rollouts.final_evaluation_split_not_trainable',
    ])
  })

  test('blocks candidate training when trainable rollouts lack root-cause summaries', () => {
    const result = trainHeuristicCandidatesFromRollouts({
      training_run_id: 'train_missing_root_cause',
      provider_model_id: 'mimo-v2.5',
      base_heuristic_bundle_version: 'hb:initial',
      rollouts: [
        rollout('1', ['tool_choice_failure.bad_args'], 'train', ''),
      ],
    })

    expect(result.status).toBe('blocked')
    expect(result.provider_model_update).toBe('none')
    expect(result.stable_promotions_allowed).toBe(false)
    expect(result.candidates).toEqual([])
    expect(result.blocked_reasons).toEqual([
      'rollouts.missing_root_cause_summary',
    ])
  })
})
